const settings: Record<string, string> = {
  // Tabs
  "settings.tab.general": "Umum",
  "settings.tab.engine": "Mesin",
  "settings.tab.integrations": "Integrasi",
  "settings.tab.secrets": "Secret",
  "settings.tab.data": "Data & backup",
  "settings.tab.about": "Tentang",

  // Page header
  "settings.description":
    "Perilaku mesin lokal, metadata keyring OS, portabilitas data, dan detail penyimpanan. Pengaturan disimpan di SQLite; nilai secret hanya tersimpan di vault kredensial sistem operasi.",
  "settings.unsavedChanges": "Perubahan belum disimpan",
  "settings.unsavedConfirm":
    "Pengaturan memiliki perubahan yang belum disimpan. Buang perubahan dan tinggalkan halaman ini?",
  "settings.saveSettings": "Simpan pengaturan",
  "settings.savedTitle": "Pengaturan tersimpan",
  "settings.savedBody": "Pengaturan mesin dan penjadwal telah diperbarui.",
  "settings.saveFailedTitle": "Tidak dapat menyimpan pengaturan",
  "settings.loadingSettings": "Memuat pengaturan…",

  // Shared
  "settings.labelCopied": "{label} disalin",
  "settings.clipboardUnavailable": "Clipboard tidak tersedia",

  // General: appearance
  "settings.appearance.title": "Tampilan",
  "settings.appearance.description": "Tema diterapkan ke seluruh antarmuka dan disimpan secara lokal.",
  "settings.theme.dark": "Gelap",
  "settings.theme.darkDesc": "Ruang kendali untuk kondisi minim cahaya.",
  "settings.theme.light": "Terang",
  "settings.theme.lightDesc": "Ruang kerja yang cerah.",
  "settings.theme.system": "Sistem",
  "settings.theme.systemDesc": "Mengikuti preferensi OS.",

  // General: log retention
  "settings.retention.title": "Retensi log",
  "settings.retention.description": "Entri lama dibersihkan saat startup dan saat log ditulis.",
  "settings.retention.days": "Retensi (hari)",
  "settings.retention.daysHint": "1–365 hari.",
  "settings.retention.maxRows": "Baris log maksimum",
  "settings.retention.maxRowsHint": "1.000–100.000 baris.",
  "settings.retention.note":
    "Retensi hanya berlaku untuk log. Riwayat eksekusi dan output langkah disimpan sampai database dihapus atau digantikan oleh restore.",

  // Engine
  "settings.engine.title": "Mesin eksekusi",
  "settings.engine.description":
    "Worker melakukan poll pada antrean eksekusi yang durable. Perubahan timeout, retry, dan jaringan langsung berlaku untuk eksekusi baru; jumlah worker berubah pada peluncuran berikutnya.",
  "settings.engine.workers": "Worker konkuren",
  "settings.engine.workersHint": "1–8. Jumlah worker diterapkan pada peluncuran aplikasi berikutnya.",
  "settings.engine.timeout": "Timeout eksekusi (detik)",
  "settings.engine.timeoutHint": "5–3.600 detik per eksekusi.",
  "settings.engine.retries": "Retry bawaan",
  "settings.engine.retriesHint": "0–5. Berlaku untuk langkah HTTP dan pemeriksaan akun.",
  "settings.engine.retryDelay": "Jeda retry (ms)",
  "settings.engine.retryDelayHint": "100–60.000 ms di antara percobaan.",
  "settings.engine.scheduler": "Penjadwal aktif",
  "settings.engine.schedulerDesc":
    "Menjeda menghentikan eksekusi terjadwal baru. Slot yang terlewat dicatat tetapi tidak pernah diputar ulang secara otomatis.",
  "settings.engine.allowLocalNetwork": "Izinkan permintaan HTTP ke jaringan lokal",
  "settings.engine.allowLocalNetworkDesc":
    "Diperlukan oleh node HTTP yang mengaktifkan localhost atau alamat privat. Mengaktifkan ini melemahkan proteksi SSRF; biarkan nonaktif kecuali workflow membutuhkan layanan lokal.",
  "settings.runtime.title": "Status runtime",
  "settings.runtime.description": "Dibaca dari mesin desktop yang sedang berjalan.",
  "settings.runtime.scheduler": "Penjadwal",
  "settings.runtime.queue": "Antrean",
  "settings.runtime.running": "Berjalan",
  "settings.runtime.nextSchedule": "Jadwal berikutnya",
  "settings.runtime.note":
    "Penjadwal berjalan setiap 15 detik. Slot yang lebih tua dari lima menit dicatat sebagai terlewat. Eksekusi yang terputus ditandai gagal saat startup.",
  "settings.safety.title": "Batas keamanan",
  "settings.safety.description": "Diterapkan oleh core lokal.",
  "settings.safety.item1": "Respons HTTP dibatasi 1 MB dan permintaan mengalami timeout per node.",
  "settings.safety.item2": "Input eksekusi dibatasi 256 KB; impor 20 MB.",
  "settings.safety.item3": "Host privat dan loopback ditolak kecuali diizinkan secara eksplisit.",
  "settings.safety.item4": "Nilai secret disamarkan (redacted) dari log dan output langkah.",

  // About
  "settings.about.app.title": "Aplikasi",
  "settings.about.app.description": "Studio video AI lokal untuk storyboard, voiceover, dan otomasi pendukung.",
  "settings.about.version": "Versi",
  "settings.about.platform": "Platform",
  "settings.about.schema": "Skema",
  "settings.about.secretBackend": "Backend secret",
  "settings.about.note":
    "Aplikasi desktop lokal-first. Tidak memerlukan telemetri, akun cloud, atau control plane jarak jauh.",
  "settings.about.credits.title": "Kredit & lisensi",
  "settings.about.credits.description": "Atribusi untuk sumber dan dependensi.",
  "settings.about.credits.automation":
    "Otomasi tetap tersedia sebagai modul pendukung untuk pemeriksaan provider, tugas produksi berulang, dan pekerjaan HTTP lokal.",
  "settings.about.loadingStorage": "Memuat detail penyimpanan…",

  // Integrations: license
  "settings.license.title": "Lisensi",
  "settings.license.description": "Lisensi terhubung ke BITS License Manager dan terikat pada perangkat ini.",
  "settings.license.loading": "Memuat lisensi…",
  "settings.license.plan": "Paket",
  "settings.license.licenseId": "ID Lisensi",
  "settings.license.device": "Perangkat",
  "settings.license.lastSynced": "Terakhir Disinkronkan",
  "settings.license.entitlements": "Hak Akses",
  "settings.license.unlink": "Putuskan",
  "settings.license.unlinkedTitle": "Lisensi Diputus",
  "settings.license.unlinkedBody": "Hubungkan lisensi lagi untuk melanjutkan.",
  "settings.license.unlinkFailed": "Gagal Memutus Lisensi",
  "settings.license.refreshFailed": "Gagal Menyegarkan Lisensi",
  "settings.license.unlinkConfirmTitle": "Putuskan Lisensi",
  "settings.license.unlinkConfirmDescription":
    "Token perangkat ini akan dicabut dan cache lisensi dihapus. Ruang kerja akan terkunci hingga Anda menghubungkan lisensi lagi.",

  // Integrations: AI drafts
  "settings.ai.title": "Draft workflow AI",
  "settings.ai.description":
    "Endpoint chat apa pun yang kompatibel dengan OpenAI. Draft yang dihasilkan divalidasi dan tidak pernah disimpan otomatis.",
  "settings.ai.keyStored": "API key tersimpan",
  "settings.ai.noKey": "Belum ada API key",
  "settings.ai.endpoint": "Endpoint",
  "settings.ai.endpointHint": "Contoh: https://api.openai.com/v1. HTTP memerlukan opt-in jaringan lokal.",
  "settings.ai.model": "Model",
  "settings.ai.modelHint": "Identitas model provider, hingga 100 karakter.",
  "settings.ai.secretHintPrefix": "Tambahkan secret bernama",
  "settings.ai.secretHintSuffix":
    "di tab Secret. Key hanya dikirim ke endpoint yang dikonfigurasi dan tidak pernah dikembalikan ke antarmuka.",
  "settings.ai.proxyUrl": "URL proxy HTTP",
  "settings.ai.proxyUrlHint": "Digunakan oleh node HTTP workflow dan draft AI, bukan webview provider.",
  "settings.ai.proxyUsername": "Nama pengguna proxy",
  "settings.ai.proxyPassword": "Kata sandi proxy",
  "settings.ai.proxyPasswordHint": "Write-only; disimpan ke keyring OS.",
  "settings.ai.saveProxyPassword": "Simpan kata sandi proxy",
  "settings.ai.removeProxyPassword": "Hapus kata sandi proxy yang tersimpan",
  "settings.ai.proxyNote":
    "Kredensial proxy tidak ditampilkan lagi. Biarkan URL kosong untuk terhubung langsung. Mesin menolak hostname tujuan yang resolve ke alamat privat saat proxy dikonfigurasi.",
  "settings.ai.proxySavedTitle": "Kredensial proxy diperbarui",
  "settings.ai.proxySavedBody": "Mesin dan draft AI menggunakan proxy baru pada permintaan berikutnya.",
  "settings.ai.proxySaveFailed": "Tidak dapat menyimpan kredensial proxy",

  // Integrations: voiceover provider
  "settings.tts.title": "Provider voiceover",
  "settings.tts.description":
    "Endpoint suara kompatibel OpenAI (opsional) untuk track suara yang dapat diunduh. Preview di browser berfungsi tanpa key.",
  "settings.tts.keyReady": "Key TTS siap",
  "settings.tts.noKey": "Belum ada key TTS",
  "settings.tts.endpoint": "Endpoint",
  "settings.tts.endpointHint": "Contoh: https://api.openai.com/v1. Aplikasi memanggil /audio/speech.",
  "settings.tts.model": "Model",
  "settings.tts.voice": "Suara",
  "settings.tts.format": "Format output",
  "settings.tts.speed": "Kecepatan",
  "settings.tts.speedHint": "0.25–4.0",
  "settings.tts.secretHint1": "Tambahkan secret bernama",
  "settings.tts.secretHint2": "di tab Secret. Jika secret tersebut tidak ada, aplikasi beralih ke",
  "settings.tts.secretHint3":
    ". Provider hanya menerima teks adegan dan pengaturan suara; tidak ada yang di-generate tanpa key.",

  // Integrations: local HTTP API
  "settings.localApi.title": "API HTTP lokal",
  "settings.localApi.description":
    "Control surface khusus loopback untuk klien lokal tepercaya. Memerlukan bearer token.",
  "settings.localApi.enable": "Aktifkan API lokal",
  "settings.localApi.enableDesc": "Hanya terikat ke 127.0.0.1. Perubahan berlaku saat pengaturan disimpan.",
  "settings.localApi.port": "Port",
  "settings.localApi.portHint": "1.024–65.535. Bawaan 47.821.",
  "settings.localApi.baseUrl": "URL dasar",
  "settings.localApi.routes": "Rute:",
  "settings.localApi.reveal": "Tampilkan token",
  "settings.localApi.rotate": "Rotasi token",
  "settings.localApi.token": "Token",
  "settings.localApi.bearerHintPrefix": "Kirim",
  "settings.localApi.bearerHintSuffix": "CORS sengaja dinonaktifkan.",
  "settings.localApi.revealedTitle": "Token API lokal ditampilkan",
  "settings.localApi.revealedBody": "Simpan di klien lokal Anda. Rotasi jika bocor.",
  "settings.localApi.revealFailed": "Tidak dapat menampilkan token",
  "settings.localApi.rotatedTitle": "Token API lokal dirotasi",
  "settings.localApi.rotatedBody": "Klien yang ada harus segera memakai token baru.",
  "settings.localApi.rotateFailed": "Tidak dapat merotasi token",

  // Integrations: updates
  "settings.updates.title": "Pembaruan aplikasi",
  "settings.updates.androidDesc":
    "Pembaruan Android dikirim sebagai rilis APK bertanda tangan yang lebih baru di GitHub. Pembaruan dalam aplikasi hanya untuk desktop.",
  "settings.updates.desktopDesc":
    "Pembaruan Tauri bertanda tangan dari endpoint manifest HTTPS. Public key pembaruan sudah tertanam di binary ini.",
  "settings.updates.manifestUrl": "URL manifest pembaruan",
  "settings.updates.manifestUrlHint":
    "JSON pembaruan Tauri mandiri. Kosong menonaktifkan pemeriksaan pembaruan. Pemilik harus mempublikasikan endpoint ini.",
  "settings.updates.checkNow": "Periksa sekarang",
  "settings.updates.androidHint": "Pasang APK bertanda tangan yang lebih baru dari GitHub Releases.",
  "settings.updates.desktopHint": "Menggunakan nilai pengaturan yang tersimpan.",
  "settings.updates.available": "Versi {version} tersedia",
  "settings.updates.current": "Saat ini",
  "settings.updates.downloadInstall": "Unduh dan pasang",
  "settings.updates.upToDate": "Instalasi ini sudah terbaru.",
  "settings.updates.note":
    "Artefak pembaruan diverifikasi dengan public key tertanam. Artefak tanpa tanda tangan atau tidak cocok ditolak. Pemilik rilis harus menandatangani setiap build dengan private key yang sesuai.",
  "settings.updates.availableToastTitle": "Pembaruan tersedia",
  "settings.updates.availableToastBody": "Versi {version} siap dipasang.",
  "settings.updates.upToDateToastTitle": "Sudah terbaru",
  "settings.updates.upToDateToastBody": "Tidak ditemukan rilis yang lebih baru di endpoint yang dikonfigurasi.",
  "settings.updates.checkFailed": "Pemeriksaan pembaruan gagal",
  "settings.updates.installedTitle": "Pembaruan terpasang",
  "settings.updates.installedBody": "BITS AI Video Creator sedang memulai ulang.",
  "settings.updates.installFailed": "Pemasangan pembaruan gagal",
  "settings.updates.installConfirmTitle": "Pasang pembaruan",
  "settings.updates.installConfirmPrefix": "BITS AI Video Creator akan mengunduh versi",
  "settings.updates.installConfirmSuffix":
    ", memverifikasi tanda tangannya, memasangnya, dan memulai ulang. Simpan perubahan workflow yang masih terbuka terlebih dahulu.",
  "settings.updates.installConfirmButton": "Pasang dan mulai ulang",

  // Secrets
  "settings.secrets.storedTitle": "Secret tersimpan",
  "settings.secrets.storedBody": "{name} disimpan oleh credential store sistem operasi.",
  "settings.secrets.deletedTitle": "Secret dihapus",
  "settings.secrets.deleteFailed": "Tidak dapat menghapus secret",
  "settings.secrets.addTitle": "Tambah secret",
  "settings.secrets.addDescription": "Nilai ditulis sekali dan tidak pernah dikembalikan ke antarmuka.",
  "settings.secrets.nameLabel": "Nama",
  "settings.secrets.valueLabel": "Nilai",
  "settings.secrets.vaultAvailable": "Vault tersedia",
  "settings.secrets.vaultUnavailable": "Vault tidak tersedia",
  "settings.secrets.vaultUnavailableWarning": "Credential store OS tidak tersedia.",
  "settings.secrets.vaultUnavailableBody":
    "Workflow berbasis secret tidak dapat berjalan sampai keyring yang didukung tersedia. Tidak ada fallback plaintext yang digunakan.",
  "settings.secrets.nameHint": "1–64 karakter: huruf, angka, ., _, -. Direferensikan sebagai {reference}.",
  "settings.secrets.valueHint": "Hingga 16 KB. Nilai dipangkas dan disimpan di vault OS.",
  "settings.secrets.valuePlaceholder": "Tempel nilai secret",
  "settings.secrets.showValue": "Tampilkan nilai secret",
  "settings.secrets.hideValue": "Sembunyikan nilai secret",
  "settings.secrets.store": "Simpan secret",
  "settings.secrets.note":
    "BITS AI Video Creator tidak menyediakan perintah untuk membaca nilai secret. Mesin hanya menyelesaikannya saat mengeksekusi langkah, dan log disamarkan.",
  "settings.secrets.listTitle": "Referensi secret tersimpan",
  "settings.secrets.listDescription": "Hanya nama dan waktu yang disimpan di SQLite.",
  "settings.secrets.loading": "Memuat referensi…",
  "settings.secrets.emptyTitle": "Belum ada secret tersimpan",
  "settings.secrets.emptyBody": "Tambahkan satu di panel kiri. Nama secret diekspor; nilai tidak pernah diekspor.",
  "settings.secrets.updated": "diperbarui",
  "settings.secrets.created": "dibuat",
  "settings.secrets.deleteAria": "Hapus secret {name}",
  "settings.secrets.deleteTitle": "Hapus secret",
  "settings.secrets.deleteConfirmPrefix": "Ini menghapus",
  "settings.secrets.deleteConfirmSuffix":
    "dari credential store sistem operasi. Workflow yang merujuknya akan gagal sampai secret ditambahkan kembali. Tindakan ini tidak dapat dibatalkan.",

  // Data & backup
  "settings.data.backupCreatedTitle": "Backup dibuat",
  "settings.data.backupCreatedBody": "{path} · integritas {integrity}",
  "settings.data.backupFailed": "Tidak dapat membuat backup",
  "settings.data.backupVerifiedTitle": "Backup terverifikasi",
  "settings.data.verifyFailed": "Verifikasi backup gagal",
  "settings.data.restoreStagedTitle": "Restore disiapkan",
  "settings.data.restoreStagedBody":
    "Tutup dan buka kembali BITS AI Video Creator untuk menerapkan database hasil restore.",
  "settings.data.stageRestoreFailed": "Tidak dapat menyiapkan restore",
  "settings.data.filePickerFailed": "Tidak dapat membuka pemilih file",
  "settings.data.importCompletedTitle": "Impor selesai",
  "settings.data.importCompletedBody": "{imported} diimpor · {replaced} diganti · {skipped} dilewati · {notices} catatan",
  "settings.data.importFailed": "Impor gagal",
  "settings.data.exportWrittenTitle": "Ekspor ditulis",
  "settings.data.exportFailed": "Tidak dapat mengekspor data",
  "settings.data.exportTitle": "Ekspor",
  "settings.data.exportDescription": "Akun, workflow, jadwal, dan nama secret. Nilai secret tidak pernah diekspor.",
  "settings.data.exportButton": "Ekspor data…",
  "settings.data.exportNote":
    "Output adalah dokumen JSON dengan versi. Akun dan workflow divalidasi saat impor, tidak pernah dikonversi secara diam-diam.",
  "settings.data.importTitle": "Impor",
  "settings.data.importDescription":
    "Ekspor BITS AI Video Creator dan file akun BITS AI Video Creator 1.x legacy didukung.",
  "settings.data.chooseFile": "Pilih file",
  "settings.data.noFileSelected": "Belum ada file dipilih",
  "settings.data.importPathAria": "Jalur file impor",
  "settings.data.duplicateStrategy": "Strategi duplikat",
  "settings.data.strategySkip": "Lewati duplikat",
  "settings.data.strategyReplace": "Ganti duplikat",
  "settings.data.strategyKeepBoth": "Simpan keduanya (ganti nama)",
  "settings.data.preview": "Pratinjau",
  "settings.data.applyImport": "Terapkan impor",
  "settings.data.recordCount": "{count} catatan",
  "settings.data.validCount": "{count} valid",
  "settings.data.duplicateCount": "{count} duplikat",
  "settings.data.backupsTitle": "Backup",
  "settings.data.backupsDescription":
    "Snapshot SQLite yang konsisten disimpan di direktori backup lokal. Integritas diperiksa saat backup dibuat.",
  "settings.data.restoreFile": "Pulihkan file…",
  "settings.data.createBackup": "Buat backup",
  "settings.data.loadingBackups": "Memuat backup…",
  "settings.data.noBackupsTitle": "Belum ada backup",
  "settings.data.noBackupsBody": "Buat snapshot sebelum memulihkan atau melakukan perubahan struktur besar.",
  "settings.data.colFile": "File",
  "settings.data.colCreated": "Dibuat",
  "settings.data.colSize": "Ukuran",
  "settings.data.colIntegrity": "Integritas",
  "settings.data.verify": "Verifikasi",
  "settings.data.restoreButton": "Pulihkan",
  "settings.data.restoreNote":
    "Restore disiapkan dan diterapkan pada peluncuran berikutnya. Database saat ini disalin ke file “bits-ai-video-creator-before-restore” sebelum digantikan.",
  "settings.data.storageTitle": "Penyimpanan lokal",
  "settings.data.storageDescription": "Jalur dan ukuran database dilaporkan oleh shell yang berjalan.",
  "settings.data.openFolder": "Buka folder",
  "settings.data.openFolderFailed": "Tidak dapat membuka folder",
  "settings.data.dataDir": "Direktori data",
  "settings.data.database": "Database",
  "settings.data.backupDir": "Direktori backup",
  "settings.data.size": "Ukuran",
  "settings.data.dataPath": "Jalur data",
  "settings.data.databasePath": "Jalur database",
  "settings.data.backupPath": "Jalur backup",
  "settings.data.loadingStorage": "Memuat informasi penyimpanan…",
  "settings.data.replaceConfirmTitle": "Ganti data duplikat?",
  "settings.data.replaceConfirmPrefix":
    "Strategi “replace” menimpa field pada akun yang ada dan mengganti definisi workflow yang ada dengan versi hasil impor. Pratinjau menemukan",
  "settings.data.replaceConfirmSuffixOne":
    "duplikat. ID akun dan workflow dipertahankan, sehingga riwayat eksekusi lokal tetap terjaga. Nilai secret tidak pernah ditimpa atau diimpor.",
  "settings.data.replaceConfirmSuffixMany":
    "duplikat. ID akun dan workflow dipertahankan, sehingga riwayat eksekusi lokal tetap terjaga. Nilai secret tidak pernah ditimpa atau diimpor.",
  "settings.data.replaceConfirmButton": "Ganti dan impor",
  "settings.data.stageRestoreTitle": "Siapkan restore database",
  "settings.data.stageRestorePrefix": "BITS AI Video Creator akan memverifikasi",
  "settings.data.stageRestoreSuffix":
    "dan menyiapkannya untuk peluncuran berikutnya. Saat memulai ulang, database saat ini dibackup dan digantikan. Akun, workflow, riwayat eksekusi, log, dan pengaturan akan berasal dari file yang dipilih. Nilai secret tidak disertakan. Tutup sesi lain sebelum memulai ulang.",
  "settings.data.stageRestoreButton": "Siapkan restore",
};

export default settings;
