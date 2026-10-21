//! Opt-in, loopback-only HTTP API for local automation.
//!
//! Security properties:
//! - binds only to `127.0.0.1`;
//! - requires a 244-bit bearer token stored in the OS credential vault;
//! - rejects browser-style `Origin`-bearing requests and unexpected `Host`s;
//! - caps headers/body, serves no CORS headers, and never returns secrets;
//! - does not accept absolute-form request targets or transfer encodings.

use bits_ai_video_creator_core::db::Database;
use bits_ai_video_creator_core::engine::RunExecutor;
use bits_ai_video_creator_core::error::{CoreError, Result};
use bits_ai_video_creator_core::license::LicenseManager;
use bits_ai_video_creator_core::models::{AccountFilter, LogFilter, RunFilter, Settings};
use bits_ai_video_creator_core::secrets::SecretStore;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use uuid::Uuid;

const TOKEN_SECRET: &str = "local.api.token";
const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = 64 * 1024;
const MAX_REQUEST_BYTES: usize = MAX_HEADER_BYTES + MAX_BODY_BYTES;
const IO_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalApiStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub base_url: Option<String>,
    pub token_configured: bool,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct LocalApi {
    inner: Arc<Inner>,
}

struct Inner {
    db: Database,
    executor: RunExecutor,
    license: LicenseManager,
    store: Arc<dyn SecretStore>,
    enabled: AtomicBool,
    port: AtomicU16,
    generation: AtomicU64,
    token: Mutex<Option<String>>,
    running: AtomicBool,
    error: Mutex<Option<String>>,
    handle: Mutex<Option<ServerHandle>>,
}

struct ServerHandle {
    stop: watch::Sender<bool>,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl LocalApi {
    pub fn new(
        db: Database,
        executor: RunExecutor,
        license: LicenseManager,
        store: Arc<dyn SecretStore>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                db,
                executor,
                license,
                store,
                enabled: AtomicBool::new(false),
                port: AtomicU16::new(47821),
                generation: AtomicU64::new(0),
                token: Mutex::new(None),
                running: AtomicBool::new(false),
                error: Mutex::new(None),
                handle: Mutex::new(None),
            }),
        }
    }

    pub fn reconfigure(&self, settings: &Settings) {
        self.inner
            .enabled
            .store(settings.local_api_enabled, Ordering::SeqCst);
        self.inner
            .port
            .store(settings.local_api_port, Ordering::SeqCst);
        self.stop();
        if !settings.local_api_enabled {
            return;
        }
        if let Err(error) = self.inner.license.require() {
            self.set_error(error.to_string());
            return;
        }
        let generation = self.inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let api = self.clone();
        let port = settings.local_api_port;
        tauri::async_runtime::spawn(async move {
            api.start_server(generation, port).await;
        });
    }

    pub fn shutdown(&self) {
        self.inner.enabled.store(false, Ordering::SeqCst);
        self.stop();
    }

    pub fn status(&self) -> LocalApiStatus {
        let running = self.inner.running.load(Ordering::SeqCst);
        let error = self.inner.error.lock().ok().and_then(|value| value.clone());
        let port = self.inner.port.load(Ordering::SeqCst);
        let token_configured = self
            .inner
            .token
            .lock()
            .map(|token| token.is_some())
            .unwrap_or(false)
            || self.inner.store.get(TOKEN_SECRET).ok().flatten().is_some();
        LocalApiStatus {
            enabled: self.inner.enabled.load(Ordering::SeqCst),
            running,
            port,
            base_url: if running {
                Some(format!("http://127.0.0.1:{port}"))
            } else {
                None
            },
            token_configured,
            error,
        }
    }

    /// Explicit reveal is only used by the local settings UI so the user can
    /// configure a trusted local client. This is not a provider credential.
    pub fn reveal_token(&self) -> Result<String> {
        self.ensure_token()
    }

    pub fn rotate_token(&self) -> Result<String> {
        let token = generate_token();
        self.inner.store.set(TOKEN_SECRET, &token)?;
        if let Ok(mut current) = self.inner.token.lock() {
            *current = Some(token.clone());
        }
        if self.inner.enabled.load(Ordering::SeqCst) {
            let settings = self.inner.db.get_settings()?;
            self.reconfigure(&settings);
        }
        Ok(token)
    }

    fn ensure_token(&self) -> Result<String> {
        if let Ok(current) = self.inner.token.lock() {
            if let Some(token) = current.as_ref() {
                return Ok(token.clone());
            }
        }
        let token = if let Some(existing) = self.inner.store.get(TOKEN_SECRET)? {
            existing
        } else {
            let token = generate_token();
            self.inner.store.set(TOKEN_SECRET, &token)?;
            token
        };
        if let Ok(mut current) = self.inner.token.lock() {
            *current = Some(token.clone());
        }
        Ok(token)
    }

    fn set_error(&self, message: impl Into<String>) {
        if let Ok(mut error) = self.inner.error.lock() {
            *error = Some(message.into());
        }
        self.inner.running.store(false, Ordering::SeqCst);
    }

    fn stop(&self) {
        self.inner.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut guard) = self.inner.handle.lock() {
            if let Some(handle) = guard.take() {
                let _ = handle.stop.send(true);
                handle.task.abort();
            }
        }
        self.inner.running.store(false, Ordering::SeqCst);
        if let Ok(mut error) = self.inner.error.lock() {
            *error = None;
        }
    }

    async fn start_server(&self, generation: u64, port: u16) {
        let token = match self.ensure_token() {
            Ok(token) => token,
            Err(error) => {
                self.set_error(error.to_string());
                return;
            }
        };
        let listener = match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => listener,
            Err(error) => {
                self.set_error(format!(
                    "Local API could not bind to 127.0.0.1:{port}: {error}"
                ));
                return;
            }
        };
        if generation != self.inner.generation.load(Ordering::SeqCst)
            || !self.inner.enabled.load(Ordering::SeqCst)
        {
            return;
        }
        let (stop_tx, mut stop_rx) = watch::channel(false);
        let api = self.clone();
        let task = tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => break,
                    accepted = listener.accept() => {
                        match accepted {
                            Ok((stream, _peer)) => {
                                let api = api.clone();
                                let token = token.clone();
                                let port = port;
                                tauri::async_runtime::spawn(async move {
                                    let _ = handle_connection(api, stream, token, port).await;
                                });
                            }
                            Err(_) => break,
                        }
                    }
                }
            }
        });
        if generation != self.inner.generation.load(Ordering::SeqCst) {
            let _ = stop_tx.send(true);
            task.abort();
            return;
        }
        if let Ok(mut handle) = self.inner.handle.lock() {
            *handle = Some(ServerHandle {
                stop: stop_tx,
                task,
            });
        }
        self.inner.running.store(true, Ordering::SeqCst);
        if let Ok(mut error) = self.inner.error.lock() {
            *error = None;
        }
    }
}

fn generate_token() -> String {
    format!(
        "bits_{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    )
}

struct Request {
    method: String,
    target: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

#[derive(Debug)]
struct Response {
    status: u16,
    body: Value,
    extra_headers: Vec<(&'static str, String)>,
}

impl Response {
    fn ok(body: Value) -> Self {
        Self {
            status: 200,
            body,
            extra_headers: vec![],
        }
    }

    fn accepted(body: Value) -> Self {
        Self {
            status: 202,
            body,
            extra_headers: vec![],
        }
    }

    fn error(status: u16, code: &str, message: &str) -> Self {
        Self {
            status,
            body: json!({"error": {"code": code, "message": message}}),
            extra_headers: vec![],
        }
    }
}

async fn handle_connection(
    api: LocalApi,
    mut stream: TcpStream,
    token: String,
    port: u16,
) -> std::io::Result<()> {
    let request = match tokio::time::timeout(IO_TIMEOUT, read_request(&mut stream)).await {
        Ok(Ok(request)) => request,
        Ok(Err((status, message))) => {
            write_response(
                &mut stream,
                &Response::error(status, "bad_request", message),
            )
            .await?;
            return Ok(());
        }
        Err(_) => {
            write_response(
                &mut stream,
                &Response::error(408, "timeout", "Request timed out"),
            )
            .await?;
            return Ok(());
        }
    };
    if !authorized(&request, &token) {
        let mut response = Response::error(401, "unauthorized", "A valid bearer token is required");
        response
            .extra_headers
            .push(("WWW-Authenticate", "Bearer".to_string()));
        write_response(&mut stream, &response).await?;
        return Ok(());
    }
    if request.headers.contains_key("origin") || request.headers.contains_key("referer") {
        write_response(
            &mut stream,
            &Response::error(
                403,
                "browser_origin_blocked",
                "Browser-origin requests are not allowed",
            ),
        )
        .await?;
        return Ok(());
    }
    if !valid_host(&request, port) {
        write_response(
            &mut stream,
            &Response::error(421, "host_mismatch", "Unexpected Host header"),
        )
        .await?;
        return Ok(());
    }
    let response = route(&api, request).await;
    write_response(&mut stream, &response).await
}

fn authorized(request: &Request, token: &str) -> bool {
    let Some(value) = request.headers.get("authorization") else {
        return false;
    };
    let Some(candidate) = value.strip_prefix("Bearer ") else {
        return false;
    };
    constant_time_eq(candidate.as_bytes(), token.as_bytes())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        difference |= a ^ b;
    }
    difference == 0
}

fn valid_host(request: &Request, port: u16) -> bool {
    let expected = format!("127.0.0.1:{port}");
    let expected_localhost = format!("localhost:{port}");
    match request.headers.get("host") {
        Some(host) => host == &expected || host == &expected_localhost,
        None => false,
    }
}

async fn write_response(stream: &mut TcpStream, response: &Response) -> std::io::Result<()> {
    let body = serde_json::to_vec(&response.body).unwrap_or_else(|_| b"{}".to_vec());
    let reason = match response.status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        409 => "Conflict",
        413 => "Payload Too Large",
        421 => "Misdirected Request",
        422 => "Unprocessable Entity",
        500 => "Internal Server Error",
        _ => "Error",
    };
    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\n",
        response.status,
        reason,
        body.len()
    );
    for (name, value) in &response.extra_headers {
        head.push_str(name);
        head.push_str(": ");
        head.push_str(value);
        head.push_str("\r\n");
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(&body).await?;
    stream.flush().await
}

async fn read_request(stream: &mut TcpStream) -> std::result::Result<Request, (u16, &'static str)> {
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let mut header_end = None;
    loop {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|_| (400, "Request could not be read"))?;
        if read == 0 {
            return Err((400, "Request ended unexpectedly"));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err((413, "Request is too large"));
        }
        if header_end.is_none() {
            if let Some(index) = find_header_end(&buffer) {
                let headers = parse_headers(&buffer[..index])?;
                let content_length = headers
                    .get("content-length")
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if content_length > MAX_BODY_BYTES {
                    return Err((413, "Request body is too large"));
                }
                header_end = Some((index, headers, content_length));
            }
        }
        if let Some((index, headers, content_length)) = &header_end {
            if buffer.len() >= index + 4 + content_length {
                let method = {
                    let line = std::str::from_utf8(&buffer[..*index])
                        .map_err(|_| (400, "Request headers are not UTF-8"))?;
                    parse_request_line(line)?
                };
                let body = buffer[*index + 4..*index + 4 + content_length].to_vec();
                return Ok(Request {
                    method,
                    target: parse_target(line_target(&buffer[..*index])?)?,
                    headers: headers.clone(),
                    body,
                });
            }
        }
    }
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_request_line(headers: &str) -> std::result::Result<String, (u16, &'static str)> {
    let line = headers
        .lines()
        .next()
        .ok_or((400, "Missing request line"))?;
    let mut parts = line.split_whitespace();
    let method = parts.next().ok_or((400, "Missing method"))?;
    let _target = parts.next().ok_or((400, "Missing request target"))?;
    let version = parts.next().ok_or((400, "Missing HTTP version"))?;
    if parts.next().is_some() || !version.starts_with("HTTP/1.") {
        return Err((400, "Malformed request line"));
    }
    if !matches!(method, "GET" | "POST") {
        return Err((405, "Only GET and POST are supported"));
    }
    Ok(method.to_string())
}

fn line_target(headers: &[u8]) -> std::result::Result<&str, (u16, &'static str)> {
    let line = std::str::from_utf8(headers)
        .map_err(|_| (400, "Request headers are not UTF-8"))?
        .lines()
        .next()
        .ok_or((400, "Missing request line"))?;
    line.split_whitespace()
        .nth(1)
        .ok_or((400, "Missing request target"))
}

fn parse_target(target: &str) -> std::result::Result<String, (u16, &'static str)> {
    if !target.starts_with('/') || target.starts_with("//") {
        return Err((400, "Only origin-form request targets are supported"));
    }
    if target.len() > 2048 || target.contains('\0') {
        return Err((400, "Request target is invalid"));
    }
    Ok(target.to_string())
}

fn parse_headers(
    headers: &[u8],
) -> std::result::Result<HashMap<String, String>, (u16, &'static str)> {
    let text = std::str::from_utf8(headers).map_err(|_| (400, "Headers are not UTF-8"))?;
    let mut result = HashMap::new();
    for line in text.lines().skip(1) {
        if line.is_empty() {
            continue;
        }
        let (name, value) = line.split_once(':').ok_or((400, "Malformed header"))?;
        let name = name.trim().to_ascii_lowercase();
        if name.is_empty() || name.len() > 100 || value.len() > 4096 {
            return Err((400, "Header is too large"));
        }
        if name == "transfer-encoding" || name == "content-encoding" {
            return Err((400, "Unsupported transport header"));
        }
        if result.insert(name, value.trim().to_string()).is_some() {
            return Err((400, "Duplicate header"));
        }
    }
    Ok(result)
}

async fn route(api: &LocalApi, request: Request) -> Response {
    let (path, query) = request
        .target
        .split_once('?')
        .unwrap_or((request.target.as_str(), ""));
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    if segments.first() != Some(&"v1") {
        return Response::error(404, "not_found", "Unknown endpoint");
    }
    let method = request.method.as_str();
    match (method, segments.as_slice()) {
        ("GET", ["v1", "health"]) => Response::ok(json!({
            "status": "ok",
            "service": "BITS AI Video Creator",
            "time": chrono::Utc::now().to_rfc3339(),
        })),
        ("GET", ["v1"]) => Response::ok(json!({
            "version": "v1",
            "endpoints": [
                "GET /v1/health",
                "GET /v1/dashboard",
                "GET /v1/accounts",
                "GET /v1/workflows",
                "GET /v1/workflows/{id}",
                "POST /v1/workflows/{id}/runs",
                "GET /v1/runs",
                "GET /v1/runs/{id}",
                "POST /v1/runs/{id}/cancel",
                "GET /v1/logs",
                "GET /v1/schedules"
            ]
        })),
        ("GET", ["v1", "dashboard"]) => match api.inner.db.dashboard() {
            Ok(value) => Response::ok(serde_json::to_value(value).unwrap_or(Value::Null)),
            Err(error) => core_error(error),
        },
        ("GET", ["v1", "accounts"]) => {
            let filter = account_filter(query);
            match api.inner.db.list_accounts(&filter) {
                Ok(value) => Response::ok(serde_json::to_value(value).unwrap_or(Value::Null)),
                Err(error) => core_error(error),
            }
        }
        ("GET", ["v1", "workflows"]) => match api.inner.db.list_workflows() {
            Ok(value) => Response::ok(serde_json::to_value(value).unwrap_or(Value::Null)),
            Err(error) => core_error(error),
        },
        ("GET", ["v1", "workflows", id]) => match api.inner.db.get_workflow(id) {
            Ok(value) => Response::ok(serde_json::to_value(value).unwrap_or(Value::Null)),
            Err(error) => core_error(error),
        },
        ("POST", ["v1", "workflows", id, "runs"]) => {
            if let Err(error) = api.inner.license.require() {
                return core_error(error);
            }
            let body: Value = match serde_json::from_slice(&request.body) {
                Ok(value) => value,
                Err(_) => return Response::error(422, "invalid_json", "Request body must be JSON"),
            };
            let input = body.get("input").cloned().unwrap_or_else(|| json!({}));
            if serde_json::to_vec(&input)
                .map(|bytes| bytes.len())
                .unwrap_or(usize::MAX)
                > 262_144
            {
                return Response::error(413, "input_too_large", "Run input is limited to 256 KB");
            }
            let idempotency_key = body
                .get("idempotencyKey")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            match api.inner.db.create_run(id, "api", &input, idempotency_key) {
                Ok(run) => {
                    api.inner.executor.wake();
                    Response::accepted(serde_json::to_value(run).unwrap_or(Value::Null))
                }
                Err(error) => core_error(error),
            }
        }
        ("GET", ["v1", "runs"]) => {
            let filter = run_filter(query);
            match api.inner.db.list_runs(&filter) {
                Ok(value) => Response::ok(serde_json::to_value(value).unwrap_or(Value::Null)),
                Err(error) => core_error(error),
            }
        }
        ("GET", ["v1", "runs", id]) => match api.inner.db.get_run_detail(id) {
            Ok(value) => Response::ok(serde_json::to_value(value).unwrap_or(Value::Null)),
            Err(error) => core_error(error),
        },
        ("POST", ["v1", "runs", id, "cancel"]) => match api.inner.db.request_cancel(id) {
            Ok(value) => Response::ok(json!({"cancelled": value})),
            Err(error) => core_error(error),
        },
        ("GET", ["v1", "logs"]) => {
            let filter = log_filter(query);
            match api.inner.db.list_logs(&filter) {
                Ok(value) => Response::ok(serde_json::to_value(value).unwrap_or(Value::Null)),
                Err(error) => core_error(error),
            }
        }
        ("GET", ["v1", "schedules"]) => match api.inner.db.list_schedules() {
            Ok(value) => Response::ok(serde_json::to_value(value).unwrap_or(Value::Null)),
            Err(error) => core_error(error),
        },
        _ => Response::error(404, "not_found", "Unknown endpoint"),
    }
}

fn core_error(error: CoreError) -> Response {
    let status = match error.code() {
        "validation" => 422,
        "not_found" => 404,
        "conflict" => 409,
        "cancelled" => 409,
        _ => 500,
    };
    let message = match error.code() {
        "validation" | "not_found" | "conflict" | "cancelled" => error.to_string(),
        _ => "The operation failed".to_string(),
    };
    Response::error(status, error.code(), &message)
}

fn account_filter(query: &str) -> AccountFilter {
    let values = query_values(query);
    AccountFilter {
        query: values.get("query").cloned(),
        provider: values.get("provider").cloned(),
        status: values.get("status").cloned(),
        tag: values.get("tag").cloned(),
        favorite: values.get("favorite").and_then(|value| value.parse().ok()),
    }
}

fn run_filter(query: &str) -> RunFilter {
    let values = query_values(query);
    RunFilter {
        workflow_id: values.get("workflowId").cloned(),
        status: values.get("status").cloned(),
        limit: values
            .get("limit")
            .and_then(|value| value.parse().ok())
            .map(|value: u32| value.min(200)),
        offset: values
            .get("offset")
            .and_then(|value| value.parse().ok())
            .map(|value: u32| value.min(1_000_000)),
    }
}

fn log_filter(query: &str) -> LogFilter {
    let values = query_values(query);
    LogFilter {
        level: values.get("level").cloned(),
        scope: values.get("scope").cloned(),
        run_id: values.get("runId").cloned(),
        query: values.get("query").cloned(),
        limit: values
            .get("limit")
            .and_then(|value| value.parse().ok())
            .map(|value: u32| value.min(500)),
        offset: values
            .get("offset")
            .and_then(|value| value.parse().ok())
            .map(|value: u32| value.min(1_000_000)),
    }
}

fn query_values(query: &str) -> HashMap<String, String> {
    let mut result = HashMap::new();
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if let (Ok(key), Ok(value)) = (percent_decode(key), percent_decode(value)) {
            if !key.is_empty() && key.len() <= 100 && value.len() <= 1000 {
                result.insert(key, value);
            }
        }
    }
    result
}

fn percent_decode(value: &str) -> std::result::Result<String, ()> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            b'%' => {
                if index + 2 >= bytes.len() {
                    return Err(());
                }
                let hex = |byte: u8| match byte {
                    b'0'..=b'9' => Some(byte - b'0'),
                    b'a'..=b'f' => Some(byte - b'a' + 10),
                    b'A'..=b'F' => Some(byte - b'A' + 10),
                    _ => None,
                };
                let high = hex(bytes[index + 1]).ok_or(())?;
                let low = hex(bytes[index + 2]).ok_or(())?;
                out.push((high << 4) | low);
                index += 3;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(out).map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_time_comparison_is_length_safe() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
    }

    #[test]
    fn parses_percent_encoded_query_values() {
        let values = query_values("query=hello+world&limit=10&bad=%ZZ");
        assert_eq!(values.get("query").map(String::as_str), Some("hello world"));
        assert_eq!(values.get("limit").map(String::as_str), Some("10"));
        assert!(!values.contains_key("bad"));
    }

    #[test]
    fn only_bearer_tokens_are_accepted() {
        let mut headers = HashMap::new();
        headers.insert("authorization".into(), "Bearer secret".into());
        let request = Request {
            method: "GET".into(),
            target: "/v1/health".into(),
            headers,
            body: vec![],
        };
        assert!(authorized(&request, "secret"));
        assert!(!authorized(&request, "other"));
    }

    #[test]
    fn host_validation_rejects_proxy_style_hosts() {
        let request = |host: Option<&str>| Request {
            method: "GET".into(),
            target: "/v1/health".into(),
            headers: host
                .map(|value| HashMap::from([("host".to_string(), value.to_string())]))
                .unwrap_or_default(),
            body: vec![],
        };
        assert!(valid_host(&request(Some("127.0.0.1:47821")), 47821));
        assert!(valid_host(&request(Some("localhost:47821")), 47821));
        assert!(!valid_host(&request(Some("example.com")), 47821));
        assert!(!valid_host(&request(None), 47821));
    }

    fn test_api() -> LocalApi {
        let db = Database::open_in_memory().unwrap();
        let secrets = bits_ai_video_creator_core::secrets::SecretVault::new(
            db.clone(),
            Arc::new(bits_ai_video_creator_core::secrets::MemorySecretStore::new()),
        );
        let license = LicenseManager::from_raw_key(db.clone(), None).unwrap();
        let engine = bits_ai_video_creator_core::engine::Engine::new(db.clone(), secrets).unwrap();
        let executor = RunExecutor::new(engine, db.clone(), Arc::new(tokio::sync::Notify::new()));
        LocalApi::new(
            db,
            executor,
            license,
            Arc::new(bits_ai_video_creator_core::secrets::MemorySecretStore::new()),
        )
    }

    #[tokio::test]
    async fn parses_a_real_http_request_line_and_headers() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            read_request(&mut stream).await.unwrap()
        });
        let mut client = TcpStream::connect(address).await.unwrap();
        client
            .write_all(
                b"GET /v1/health?verbose=1 HTTP/1.1\r\nHost: 127.0.0.1:1\r\nAuthorization: Bearer abc\r\n\r\n",
            )
            .await
            .unwrap();
        let request = server.await.unwrap();
        assert_eq!(request.method, "GET");
        assert_eq!(request.target, "/v1/health?verbose=1");
        assert_eq!(
            request.headers.get("host").map(String::as_str),
            Some("127.0.0.1:1")
        );
        assert!(request.body.is_empty());
    }

    #[tokio::test]
    async fn health_and_dashboard_routes_return_data() {
        let api = test_api();
        let health = route(
            &api,
            Request {
                method: "GET".into(),
                target: "/v1/health".into(),
                headers: HashMap::new(),
                body: vec![],
            },
        )
        .await;
        assert_eq!(health.status, 200);
        assert_eq!(
            health.body.get("status").and_then(Value::as_str),
            Some("ok")
        );

        let dashboard = route(
            &api,
            Request {
                method: "GET".into(),
                target: "/v1/dashboard".into(),
                headers: HashMap::new(),
                body: vec![],
            },
        )
        .await;
        assert_eq!(dashboard.status, 200);

        let missing = route(
            &api,
            Request {
                method: "GET".into(),
                target: "/v1/nope".into(),
                headers: HashMap::new(),
                body: vec![],
            },
        )
        .await;
        assert_eq!(missing.status, 404);
    }

    async fn raw_request(port: u16, request: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        response
    }

    #[tokio::test]
    async fn loopback_server_enforces_bearer_auth_and_host_checks() {
        let api = test_api();
        let free = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = free.local_addr().unwrap().port();
        drop(free);
        let token = api.ensure_token().unwrap();
        api.inner.enabled.store(true, Ordering::SeqCst);
        let generation = api.inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
        api.start_server(generation, port).await;
        assert!(api.status().running);

        let unauthorized = raw_request(
            port,
            &format!("GET /v1/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"),
        )
        .await;
        assert!(unauthorized.starts_with("HTTP/1.1 401"), "{unauthorized}");

        let health = raw_request(
            port,
            &format!(
                "GET /v1/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\n\r\n"
            ),
        )
        .await;
        assert!(health.starts_with("HTTP/1.1 200"), "{health}");
        assert!(health.contains("\"status\":\"ok\""), "{health}");

        let browser = raw_request(
            port,
            &format!(
                "GET /v1/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nOrigin: https://evil.example\r\n\r\n"
            ),
        )
        .await;
        assert!(browser.starts_with("HTTP/1.1 403"), "{browser}");

        api.shutdown();
        assert!(!api.status().running);
    }

    #[tokio::test]
    async fn creating_a_run_through_the_api_queues_it() {
        let api = test_api();
        let workflow = api
            .inner
            .db
            .create_workflow(&bits_ai_video_creator_core::models::WorkflowInput {
                name: "API run".into(),
                description: String::new(),
                tags: vec![],
                enabled: true,
                definition: serde_json::from_value(serde_json::json!({
                    "schemaVersion": 1,
                    "nodes": [
                        {"id":"start","type":"trigger.manual","name":"Start","config":{}},
                        {"id":"log","type":"action.log","name":"Log","config":{"message":"hello"}}
                    ],
                    "edges": [{"id":"e1","from":"start","to":"log"}]
                }))
                .unwrap(),
                schedule: None,
            })
            .unwrap();
        let response = route(
            &api,
            Request {
                method: "POST".into(),
                target: format!("/v1/workflows/{}/runs", workflow.id),
                headers: HashMap::new(),
                body: br#"{"input":{"hello":"world"},"idempotencyKey":"api-test-1"}"#.to_vec(),
            },
        )
        .await;
        assert_eq!(response.status, 202);
        assert_eq!(
            api.inner.db.list_runs(&RunFilter::default()).unwrap().len(),
            1
        );
    }
}
