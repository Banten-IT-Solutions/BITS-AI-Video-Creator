//! Native storyboard and voiceover domain.
//!
//! A storyboard is a local aggregate: scenes contain ordered shots and an
//! optional voiceover script. The aggregate is stored as JSON in SQLite while
//! denormalised counts keep list and dashboard queries fast. Exports are pure
//! functions so they can be tested without the desktop shell.

use crate::error::{CoreError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const STORYBOARD_SCHEMA_VERSION: u32 = 1;
pub const MAX_SCENES: usize = 100;
pub const MAX_SHOTS_PER_SCENE: usize = 50;
pub const MAX_SHOT_TEXT_CHARS: usize = 4_000;
pub const MAX_SCENE_TEXT_CHARS: usize = 2_000;
pub const MAX_VOICEOVER_CHARS: usize = 8_000;
pub const MAX_LOGLINE_CHARS: usize = 500;
pub const DEFAULT_SHOT_DURATION_SECONDS: u32 = 5;
pub const MIN_SHOT_DURATION_SECONDS: u32 = 1;
pub const MAX_SHOT_DURATION_SECONDS: u32 = 600;
pub const ASPECT_RATIOS: &[&str] = &["16:9", "9:16", "1:1", "4:5", "21:9"];
pub const DEFAULT_ASPECT_RATIO: &str = "16:9";
pub const DEFAULT_STYLE: &str = "Cinematic";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Voiceover {
    #[serde(default)]
    pub text: String,
    /// Browser voice name or provider voice identifier. Empty uses the
    /// default voice chosen by the client.
    #[serde(default)]
    pub voice: String,
    #[serde(default = "default_voice_rate")]
    pub rate: f32,
    #[serde(default = "default_voice_pitch")]
    pub pitch: f32,
    #[serde(default = "default_voice_volume")]
    pub volume: f32,
}

impl Default for Voiceover {
    fn default() -> Self {
        Self {
            text: String::new(),
            voice: String::new(),
            rate: default_voice_rate(),
            pitch: default_voice_pitch(),
            volume: default_voice_volume(),
        }
    }
}

fn default_voice_rate() -> f32 {
    1.0
}

fn default_voice_pitch() -> f32 {
    1.0
}

fn default_voice_volume() -> f32 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub id: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub camera: String,
    #[serde(default = "default_shot_duration")]
    pub duration_seconds: u32,
    #[serde(default)]
    pub dialogue: String,
    #[serde(default)]
    pub transition: String,
}

fn default_shot_duration() -> u32 {
    DEFAULT_SHOT_DURATION_SECONDS
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub time_of_day: String,
    #[serde(default)]
    pub shots: Vec<Shot>,
    #[serde(default)]
    pub voiceover: Voiceover,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoryboardSummary {
    pub id: String,
    pub title: String,
    pub logline: String,
    pub style: String,
    pub aspect_ratio: String,
    pub scene_count: i64,
    pub shot_count: i64,
    pub total_duration_seconds: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Storyboard {
    pub id: String,
    pub schema_version: u32,
    pub title: String,
    pub logline: String,
    pub style: String,
    pub aspect_ratio: String,
    pub scenes: Vec<Scene>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryboardInput {
    pub title: String,
    #[serde(default)]
    pub logline: String,
    #[serde(default = "default_style")]
    pub style: String,
    #[serde(default = "default_aspect_ratio")]
    pub aspect_ratio: String,
    #[serde(default)]
    pub scenes: Vec<Scene>,
}

fn default_style() -> String {
    DEFAULT_STYLE.into()
}

fn default_aspect_ratio() -> String {
    DEFAULT_ASPECT_RATIO.into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceoverAsset {
    pub id: String,
    pub storyboard_id: String,
    pub scene_id: String,
    pub path: String,
    pub format: String,
    pub bytes: i64,
    pub voice: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoryboardCounts {
    pub scenes: usize,
    pub shots: usize,
    pub duration_seconds: u32,
}

/// Trim user input, fill missing ids and defaults, then validate every field.
/// The returned value is what should be persisted.
pub fn normalize_storyboard_input(input: &StoryboardInput) -> Result<StoryboardInput> {
    let mut normalized = input.clone();
    normalized.title = normalized.title.trim().to_string();
    normalized.logline = normalized.logline.trim().to_string();
    normalized.style = normalized.style.trim().to_string();
    normalized.aspect_ratio = normalized.aspect_ratio.trim().to_string();

    if normalized.title.is_empty() || normalized.title.chars().count() > 120 {
        return Err(CoreError::validation(
            "Storyboard title must be between 1 and 120 characters",
        ));
    }
    if normalized.logline.chars().count() > MAX_LOGLINE_CHARS {
        return Err(CoreError::validation(
            "Logline is limited to 500 characters",
        ));
    }
    if normalized.style.is_empty() {
        normalized.style = DEFAULT_STYLE.into();
    }
    if normalized.style.chars().count() > 120 {
        return Err(CoreError::validation(
            "Visual style is limited to 120 characters",
        ));
    }
    if normalized.aspect_ratio.is_empty() {
        normalized.aspect_ratio = DEFAULT_ASPECT_RATIO.into();
    }
    if !ASPECT_RATIOS.contains(&normalized.aspect_ratio.as_str()) {
        return Err(CoreError::validation("Unsupported aspect ratio"));
    }
    if normalized.scenes.len() > MAX_SCENES {
        return Err(CoreError::validation(
            "A storyboard can contain at most 100 scenes",
        ));
    }

    let mut scene_ids = HashSet::new();
    let mut shot_ids = HashSet::new();
    for (scene_index, scene) in normalized.scenes.iter_mut().enumerate() {
        scene.id = scene.id.trim().to_string();
        if scene.id.is_empty() {
            scene.id = uuid::Uuid::new_v4().to_string();
        }
        if !valid_id(&scene.id) {
            return Err(CoreError::validation(format!(
                "Scene {} has an invalid id",
                scene_index + 1
            )));
        }
        if !scene_ids.insert(scene.id.clone()) {
            return Err(CoreError::validation(
                "Scene ids must be unique across the storyboard",
            ));
        }
        scene.title = scene.title.trim().to_string();
        if scene.title.is_empty() {
            scene.title = format!("Scene {}", scene_index + 1);
        }
        if scene.title.chars().count() > 160 {
            return Err(CoreError::validation(format!(
                "Scene {} title is limited to 160 characters",
                scene_index + 1
            )));
        }
        scene.description = scene.description.trim().to_string();
        scene.location = scene.location.trim().to_string();
        scene.time_of_day = scene.time_of_day.trim().to_string();
        for (label, value) in [
            ("description", &scene.description),
            ("location", &scene.location),
            ("time of day", &scene.time_of_day),
        ] {
            if value.chars().count() > MAX_SCENE_TEXT_CHARS {
                return Err(CoreError::validation(format!(
                    "Scene {} {label} is limited to 2,000 characters",
                    scene_index + 1
                )));
            }
        }
        if scene.shots.len() > MAX_SHOTS_PER_SCENE {
            return Err(CoreError::validation(format!(
                "Scene {} can contain at most 50 shots",
                scene_index + 1
            )));
        }
        for (shot_index, shot) in scene.shots.iter_mut().enumerate() {
            shot.id = shot.id.trim().to_string();
            if shot.id.is_empty() {
                shot.id = uuid::Uuid::new_v4().to_string();
            }
            if !valid_id(&shot.id) {
                return Err(CoreError::validation(format!(
                    "Scene {} shot {} has an invalid id",
                    scene_index + 1,
                    shot_index + 1
                )));
            }
            if !shot_ids.insert(shot.id.clone()) {
                return Err(CoreError::validation(
                    "Shot ids must be unique across the storyboard",
                ));
            }
            shot.description = shot.description.trim().to_string();
            shot.prompt = shot.prompt.trim().to_string();
            shot.camera = shot.camera.trim().to_string();
            shot.dialogue = shot.dialogue.trim().to_string();
            shot.transition = shot.transition.trim().to_string();
            for (label, value) in [
                ("description", &shot.description),
                ("prompt", &shot.prompt),
                ("camera", &shot.camera),
                ("dialogue", &shot.dialogue),
                ("transition", &shot.transition),
            ] {
                if value.chars().count() > MAX_SHOT_TEXT_CHARS {
                    return Err(CoreError::validation(format!(
                        "Scene {} shot {} {label} is limited to 4,000 characters",
                        scene_index + 1,
                        shot_index + 1
                    )));
                }
            }
            if shot.duration_seconds == 0 {
                shot.duration_seconds = DEFAULT_SHOT_DURATION_SECONDS;
            }
            if !(MIN_SHOT_DURATION_SECONDS..=MAX_SHOT_DURATION_SECONDS)
                .contains(&shot.duration_seconds)
            {
                return Err(CoreError::validation(format!(
                    "Scene {} shot {} duration must be between 1 and 600 seconds",
                    scene_index + 1,
                    shot_index + 1
                )));
            }
        }
        scene.voiceover.text = scene.voiceover.text.trim().to_string();
        scene.voiceover.voice = scene.voiceover.voice.trim().to_string();
        if scene.voiceover.text.chars().count() > MAX_VOICEOVER_CHARS {
            return Err(CoreError::validation(format!(
                "Scene {} voiceover is limited to 8,000 characters",
                scene_index + 1
            )));
        }
        if scene.voiceover.voice.chars().count() > 160 {
            return Err(CoreError::validation(format!(
                "Scene {} voice name is limited to 160 characters",
                scene_index + 1
            )));
        }
        if !(0.5..=2.0).contains(&scene.voiceover.rate) {
            return Err(CoreError::validation(
                "Voiceover rate must be between 0.5 and 2.0",
            ));
        }
        if !(0.0..=2.0).contains(&scene.voiceover.pitch) {
            return Err(CoreError::validation(
                "Voiceover pitch must be between 0 and 2.0",
            ));
        }
        if !(0.0..=1.0).contains(&scene.voiceover.volume) {
            return Err(CoreError::validation(
                "Voiceover volume must be between 0 and 1.0",
            ));
        }
    }

    Ok(normalized)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

pub fn storyboard_counts(scenes: &[Scene]) -> StoryboardCounts {
    let shots = scenes.iter().map(|scene| scene.shots.len()).sum();
    let duration_seconds = scenes
        .iter()
        .flat_map(|scene| scene.shots.iter())
        .map(|shot| shot.duration_seconds)
        .sum();
    StoryboardCounts {
        scenes: scenes.len(),
        shots,
        duration_seconds,
    }
}

pub fn storyboard_to_json(storyboard: &Storyboard) -> Result<String> {
    Ok(serde_json::to_string_pretty(storyboard)?)
}

pub fn storyboard_to_markdown(storyboard: &Storyboard) -> String {
    let counts = storyboard_counts(&storyboard.scenes);
    let mut output = String::new();
    output.push_str(&format!("# {}\n\n", storyboard.title));
    if !storyboard.logline.is_empty() {
        output.push_str(&format!("> {}\n\n", storyboard.logline));
    }
    output.push_str(&format!(
        "**Style:** {} · **Aspect ratio:** {} · **Runtime:** {} · **Scenes:** {} · **Shots:** {}\n\n",
        storyboard.style,
        storyboard.aspect_ratio,
        format_duration(counts.duration_seconds),
        counts.scenes,
        counts.shots
    ));
    output.push_str("---\n\n");

    if storyboard.scenes.is_empty() {
        output.push_str("_No scenes yet._\n");
        return output;
    }

    for (scene_index, scene) in storyboard.scenes.iter().enumerate() {
        output.push_str(&format!("## {}. {}\n\n", scene_index + 1, scene.title));
        let mut meta = Vec::new();
        if !scene.location.is_empty() {
            meta.push(format!("**Location:** {}", scene.location));
        }
        if !scene.time_of_day.is_empty() {
            meta.push(format!("**Time:** {}", scene.time_of_day));
        }
        if !meta.is_empty() {
            output.push_str(&format!("{}\n\n", meta.join(" · ")));
        }
        if !scene.description.is_empty() {
            output.push_str(&format!("{}\n\n", scene.description));
        }
        if !scene.voiceover.text.is_empty() {
            output.push_str("### Voiceover\n\n");
            output.push_str(&format!("{}\n\n", scene.voiceover.text));
            output.push_str(&format!(
                "_Voice: {} · rate {:.2} · pitch {:.2}_\n\n",
                if scene.voiceover.voice.is_empty() {
                    "default"
                } else {
                    &scene.voiceover.voice
                },
                scene.voiceover.rate,
                scene.voiceover.pitch
            ));
        }
        for (shot_index, shot) in scene.shots.iter().enumerate() {
            output.push_str(&format!(
                "### Shot {}.{} — {}s\n\n",
                scene_index + 1,
                shot_index + 1,
                shot.duration_seconds
            ));
            if !shot.description.is_empty() {
                output.push_str(&format!("{}\n\n", shot.description));
            }
            if !shot.prompt.is_empty() {
                output.push_str(&format!("**Prompt:** {}\n\n", shot.prompt));
            }
            let mut details = Vec::new();
            if !shot.camera.is_empty() {
                details.push(format!("**Camera:** {}", shot.camera));
            }
            if !shot.dialogue.is_empty() {
                details.push(format!("**Dialogue:** {}", shot.dialogue));
            }
            if !shot.transition.is_empty() {
                details.push(format!("**Transition:** {}", shot.transition));
            }
            if !details.is_empty() {
                output.push_str(&format!("{}\n\n", details.join(" · ")));
            }
        }
    }
    output.push_str("---\n\n_Exported from BITS AI Video Creator._\n");
    output
}

pub fn compose_shot_prompt(storyboard: &Storyboard, scene: &Scene, shot: &Shot) -> String {
    let mut parts = vec![
        format!("Style: {}", storyboard.style),
        format!("Aspect ratio: {}", storyboard.aspect_ratio),
        format!("Scene: {}", scene.title),
    ];
    if !scene.location.is_empty() {
        parts.push(format!("Location: {}", scene.location));
    }
    if !scene.time_of_day.is_empty() {
        parts.push(format!("Time: {}", scene.time_of_day));
    }
    if !shot.description.is_empty() {
        parts.push(shot.description.clone());
    }
    if !shot.prompt.is_empty() {
        parts.push(shot.prompt.clone());
    }
    if !shot.camera.is_empty() {
        parts.push(format!("Camera: {}", shot.camera));
    }
    if !shot.transition.is_empty() {
        parts.push(format!("Transition: {}", shot.transition));
    }
    parts.join("\n")
}

pub fn format_duration(seconds: u32) -> String {
    let minutes = seconds / 60;
    let remainder = seconds % 60;
    if minutes > 0 {
        format!("{minutes}m {remainder:02}s")
    } else {
        format!("{remainder}s")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shot(id: &str, duration: u32) -> Shot {
        Shot {
            id: id.into(),
            description: "A wide establishing shot".into(),
            prompt: "Sunlit coastal road, slow dolly".into(),
            camera: "Slow dolly in".into(),
            duration_seconds: duration,
            dialogue: "We start here.".into(),
            transition: "Cut".into(),
        }
    }

    fn input() -> StoryboardInput {
        StoryboardInput {
            title: "  A Small Journey  ".into(),
            logline: "A courier crosses the island before sunset.".into(),
            style: "Warm cinematic".into(),
            aspect_ratio: "16:9".into(),
            scenes: vec![Scene {
                id: "scene-1".into(),
                title: "Departure".into(),
                description: "The courier leaves the harbour.".into(),
                location: "Harbour".into(),
                time_of_day: "Morning".into(),
                shots: vec![shot("shot-1", 6), shot("shot-2", 4)],
                voiceover: Voiceover {
                    text: "Every delivery starts with a departure.".into(),
                    ..Voiceover::default()
                },
            }],
        }
    }

    #[test]
    fn normalization_trims_and_counts_the_aggregate() {
        let normalized = normalize_storyboard_input(&input()).unwrap();
        assert_eq!(normalized.title, "A Small Journey");
        let counts = storyboard_counts(&normalized.scenes);
        assert_eq!(counts.scenes, 1);
        assert_eq!(counts.shots, 2);
        assert_eq!(counts.duration_seconds, 10);
    }

    #[test]
    fn missing_ids_are_generated_and_duplicate_ids_are_rejected() {
        let mut value = input();
        value.scenes[0].shots[0].id.clear();
        let normalized = normalize_storyboard_input(&value).unwrap();
        assert!(!normalized.scenes[0].shots[0].id.is_empty());

        let mut duplicate = input();
        duplicate.scenes[0].shots[1].id = duplicate.scenes[0].shots[0].id.clone();
        assert!(normalize_storyboard_input(&duplicate).is_err());
    }

    #[test]
    fn rejects_invalid_aspect_ratio_and_voice_values() {
        let mut value = input();
        value.aspect_ratio = "square".into();
        assert!(normalize_storyboard_input(&value).is_err());

        let mut value = input();
        value.scenes[0].voiceover.rate = 3.0;
        assert!(normalize_storyboard_input(&value).is_err());
    }

    #[test]
    fn markdown_export_contains_scenes_shots_and_voiceover() {
        let normalized = normalize_storyboard_input(&input()).unwrap();
        let storyboard = Storyboard {
            id: "storyboard-1".into(),
            schema_version: STORYBOARD_SCHEMA_VERSION,
            title: normalized.title,
            logline: normalized.logline,
            style: normalized.style,
            aspect_ratio: normalized.aspect_ratio,
            scenes: normalized.scenes,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        let markdown = storyboard_to_markdown(&storyboard);
        assert!(markdown.contains("# A Small Journey"));
        assert!(markdown.contains("## 1. Departure"));
        assert!(markdown.contains("### Shot 1.1 — 6s"));
        assert!(markdown.contains("Every delivery starts with a departure."));
        assert!(markdown.contains("Exported from BITS AI Video Creator"));
    }

    #[test]
    fn duration_format_is_readable() {
        assert_eq!(format_duration(0), "0s");
        assert_eq!(format_duration(59), "59s");
        assert_eq!(format_duration(61), "1m 01s");
    }
}
