use dehumanized::play::PlayFactory;
use dehumanized::skill::SkillFactory;
use dehumanized::skills::registry::{PLAYS, SKILLS};
use serde_json::{Value, json};

/// Schema-renderer document for the runtime registry browser.
///
/// Simhark adds one renderer mode per controllable Dehumanized team before
/// publishing this document to the frontend.
pub fn renderer_schema() -> Value {
  json!({
    "id": "dehumanized-registry",
    "title": "Dehumanized AI Lab",
    "description": "Invoke a registered skill or play directly against the live simulation.",
    "tabs": [
      {
        "id": "skills",
        "label": "Skills",
        "icon": "bolt",
        "badge": SKILLS.len().to_string(),
        "source": {
          "kind": "inline",
          "part": registry_part(
            "skills",
            "Skills",
            "Low-level robot behaviours registered by Dehumanized.",
            SKILLS.0,
            false,
          ),
        },
      },
      {
        "id": "plays",
        "label": "Plays",
        "icon": "playbook",
        "badge": "WIP",
        "source": {
          "kind": "inline",
          "part": registry_play_part(
            "plays",
            "Plays",
            "Play registration is wired up, but the play factory is still work in progress.",
            PLAYS.0,
            true,
          ),
        },
      },
    ],
    "initialTabId": "skills",
  })
}

fn registry_part(
  id: &str,
  title: &str,
  description: &str,
  entries: &'static [(&'static str, &'static dyn SkillFactory)],
  wip: bool,
) -> Value {
  let entries = entries
    .iter()
    .map(|(name, factory)| {
      let definition = factory.def();
      let part_id = format!("{id}.{}", schema_id(name));
      json!({
        "id": *name,
        "label": *name,
        "badge": wip.then_some("WIP"),
        "source": {
          "kind": "inline",
          "part": {
            "kind": "form",
            "id": part_id,
            "title": *name,
            "eyebrow": if wip { "Play" } else { "Skill" },
            "status": "Direct drive",
            "sections": [
              {
                "id": "config",
                "title": "Configuration",
                "schema": definition.config,
                "initialValue": factory.default_config(),
              },
              {
                "id": "params",
                "title": "Parameters",
                "schema": definition.params,
                "initialValue": factory.default_params(),
              },
            ],
          },
        },
      })
    })
    .collect::<Vec<_>>();

  json!({
    "kind": "registry",
    "id": id,
    "title": title,
    "description": description,
    "entries": entries,
  })
}

fn registry_play_part(
  id: &str,
  title: &str,
  description: &str,
  entries: &'static [(&'static str, &'static dyn PlayFactory)],
  wip: bool,
) -> Value {
  let entries = entries
    .iter()
    .map(|(name, factory)| {
      let definition = factory.def();
      let part_id = format!("{id}.{}", schema_id(name));
      json!({
        "id": *name,
        "label": *name,
        "badge": wip.then_some("WIP"),
        "source": {
          "kind": "inline",
          "part": {
            "kind": "form",
            "id": part_id,
            "title": *name,
            "eyebrow": if wip { "Play" } else { "Skill" },
            "status": "Direct drive",
            "sections": [
              {
                "id": "config",
                "title": "Configuration",
                "schema": definition.config,
                "initialValue": factory.default_config(),
              },
              {
                "id": "params",
                "title": "Parameters",
                "schema": definition.params,
                "initialValue": factory.default_params(),
              },
            ],
          },
        },
      })
    })
    .collect::<Vec<_>>();

  json!({
    "kind": "registry",
    "id": id,
    "title": title,
    "description": description,
    "entries": entries,
  })
}

fn schema_id(name: &str) -> String {
  name
    .chars()
    .map(|character| {
      if character.is_ascii_alphanumeric() {
        character.to_ascii_lowercase()
      } else {
        '_'
      }
    })
    .collect()
}
