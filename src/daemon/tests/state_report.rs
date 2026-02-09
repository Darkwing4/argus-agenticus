use argus_agenticus::alloc_tracker;

#[global_allocator]
static GLOBAL: alloc_tracker::TrackingAllocator = alloc_tracker::TrackingAllocator;

use argus_agenticus::protocol::AgentState;
use argus_agenticus::state::{AutoFocusEvent, StateManager};

use std::fmt::Write as FmtWrite;
use std::fs;
use std::sync::Arc;
use std::time::Instant;

struct TestResult {
    name: String,
    passed: bool,
    time_ns: u128,
    alloc_count: u64,
    alloc_bytes: u64,
}

fn run_test<F: FnOnce() -> bool>(name: &str, f: F) -> TestResult {
    alloc_tracker::reset();
    let start = Instant::now();
    let passed = f();
    let elapsed = start.elapsed().as_nanos();
    let snap = alloc_tracker::snapshot();
    TestResult {
        name: name.to_string(),
        passed,
        time_ns: elapsed,
        alloc_count: snap.count,
        alloc_bytes: snap.bytes,
    }
}

fn format_time(ns: u128) -> String {
    if ns >= 1_000_000 {
        format!("{:.1}ms", ns as f64 / 1_000_000.0)
    } else if ns >= 1_000 {
        format!("{:.1}us", ns as f64 / 1_000.0)
    } else {
        format!("{}ns", ns)
    }
}

fn s(name: &str) -> String {
    name.to_string()
}

fn a(name: &str) -> Arc<str> {
    Arc::from(name)
}

fn test_update_state_awaiting() -> bool {
    let mut sm = StateManager::new();
    let ev = sm.update_state(s("proj#1"), AgentState::Started, s("bash"), a("claude"));
    assert_eq!(ev, AutoFocusEvent::None);

    let ev = sm.update_state(s("proj#1"), AgentState::Awaiting, s("bash"), a("claude"));
    assert_eq!(ev, AutoFocusEvent::Trigger);

    let data = sm.get_render_data();
    assert_eq!(data.len(), 1);
    assert_eq!(data[0].state, AgentState::Awaiting);
    true
}

fn test_update_state_left_awaiting() -> bool {
    let mut sm = StateManager::new();
    sm.update_state(s("proj#1"), AgentState::Awaiting, s("bash"), a("claude"));

    let ev = sm.update_state(s("proj#1"), AgentState::Started, s("bash"), a("claude"));
    assert_eq!(ev, AutoFocusEvent::Trigger);

    let next = sm.next_awaiting();
    assert!(next.is_none());
    true
}

fn test_update_state_completed_focused() -> bool {
    let mut sm = StateManager::new();
    sm.update_state(s("proj#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_window_focus("proj - editor");

    let ev = sm.update_state(s("proj#1"), AgentState::Completed, s("bash"), a("claude"));
    assert_eq!(ev, AutoFocusEvent::None);

    let data = sm.get_render_data();
    assert_eq!(data[0].state, AgentState::Started);
    true
}

fn test_update_state_ended() -> bool {
    let mut sm = StateManager::new();
    sm.update_state(s("proj#1"), AgentState::Awaiting, s("bash"), a("claude"));
    sm.set_idle(true);
    sm.set_auto_focus_config(true, 1000);
    sm.next_awaiting();

    let ev = sm.update_state(s("proj#1"), AgentState::Ended, s("bash"), a("claude"));
    assert_eq!(ev, AutoFocusEvent::QueueEmpty);

    let data = sm.get_render_data();
    assert_eq!(data[0].state, AgentState::Ended);
    true
}

fn test_update_window_focus() -> bool {
    let mut sm = StateManager::new();
    sm.update_state(s("proj#1"), AgentState::Completed, s("bash"), a("claude"));

    let changed = sm.update_window_focus("proj - editor");
    assert!(changed);

    let data = sm.get_render_data();
    assert_eq!(data[0].state, AgentState::Started);
    assert!(data[0].focused);
    true
}

fn test_cleanup_ended() -> bool {
    let mut sm = StateManager::new();
    sm.update_state(s("proj#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_workspace("proj#1", 1, 0);
    sm.update_state(s("proj#1"), AgentState::Ended, s("bash"), a("claude"));

    let changed = sm.cleanup_ended();
    assert!(!changed);

    assert_eq!(sm.get_render_data().len(), 1);
    true
}

fn test_focus_next_deterministic() -> bool {
    let mut sm = StateManager::new();
    sm.update_state(s("alpha#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_state(s("beta#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_state(s("gamma#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_workspace("alpha", 2, 0);
    sm.update_workspace("beta", 1, 0);
    sm.update_workspace("gamma", 3, 0);

    let first = sm.focus_next().unwrap();
    assert_eq!(first, "alpha#1");

    let second = sm.focus_next().unwrap();
    assert_eq!(second, "gamma#1");

    let third = sm.focus_next().unwrap();
    assert_eq!(third, "beta#1");
    true
}

fn test_focus_next_priority() -> bool {
    let mut sm = StateManager::new();
    sm.update_state(s("a#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_state(s("b#1"), AgentState::Completed, s("bash"), a("claude"));
    sm.update_state(s("c#1"), AgentState::Awaiting, s("bash"), a("claude"));

    let first = sm.focus_next().unwrap();
    assert_eq!(first, "c#1");
    true
}

fn test_render_data_grouping() -> bool {
    let mut sm = StateManager::new();
    sm.update_state(s("proj#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_state(s("proj#2"), AgentState::Started, s("bash"), a("claude"));
    sm.update_state(s("other#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_workspace("proj", 1, 0);
    sm.update_workspace("other", 2, 0);

    let data = sm.get_render_data();
    assert_eq!(data.len(), 3);

    let proj_groups: Vec<u32> = data.iter().filter(|a| a.session.starts_with("proj")).map(|a| a.group).collect();
    assert!(proj_groups.iter().all(|&g| g == proj_groups[0]));

    let other_group = data.iter().find(|a| a.session.starts_with("other")).unwrap().group;
    assert_ne!(proj_groups[0], other_group);
    true
}

fn test_render_data_sorting() -> bool {
    let mut sm = StateManager::new();
    sm.update_state(s("z_proj#2"), AgentState::Started, s("bash"), a("claude"));
    sm.update_state(s("z_proj#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_state(s("a_proj#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_workspace("a_proj", 1, 0);
    sm.update_workspace("z_proj", 2, 0);

    let data = sm.get_render_data();
    let sessions: Vec<&str> = data.iter().map(|a| a.session.as_str()).collect();
    assert_eq!(sessions, vec!["a_proj#1", "z_proj#1", "z_proj#2"]);
    true
}

fn test_render_data_sorting_by_monitor() -> bool {
    let mut sm = StateManager::new();
    sm.update_state(s("mon0_ws2#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_state(s("mon1_ws0#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_state(s("mon0_ws1#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_workspace("mon0_ws2", 2, 0);
    sm.update_workspace("mon1_ws0", 0, 1);
    sm.update_workspace("mon0_ws1", 1, 0);

    let data = sm.get_render_data();
    let sessions: Vec<&str> = data.iter().map(|a| a.session.as_str()).collect();
    assert_eq!(sessions, vec!["mon0_ws1#1", "mon0_ws2#1", "mon1_ws0#1"]);
    true
}

fn test_monitor_change_reorders() -> bool {
    let mut sm = StateManager::new();
    sm.update_state(s("alpha#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_state(s("beta#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_workspace("alpha", 2, 0);
    sm.update_workspace("beta", 1, 1);

    let data = sm.get_render_data();
    let sessions: Vec<&str> = data.iter().map(|a| a.session.as_str()).collect();
    assert_eq!(sessions, vec!["alpha#1", "beta#1"]);

    sm.update_workspace("alpha", 2, 1);

    let data = sm.get_render_data();
    let sessions: Vec<&str> = data.iter().map(|a| a.session.as_str()).collect();
    assert_eq!(sessions, vec!["beta#1", "alpha#1"]);
    true
}

fn test_auto_focus() -> bool {
    let mut sm = StateManager::new();

    assert!(!sm.should_auto_focus());

    sm.set_auto_focus_config(true, 500);
    assert!(!sm.should_auto_focus());

    sm.set_idle(true);
    assert!(!sm.should_auto_focus());

    sm.update_state(s("proj#1"), AgentState::Awaiting, s("bash"), a("claude"));
    assert!(sm.should_auto_focus());
    assert_eq!(sm.focus_delay_ms(), 500);

    let next = sm.next_awaiting();
    assert_eq!(next, Some(s("proj#1")));
    true
}

fn test_cleanup_preserves_other_workspaces() -> bool {
    let mut sm = StateManager::new();
    sm.update_state(s("alive#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_state(s("dead#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_workspace("alive", 1, 0);
    sm.update_workspace("dead", 2, 0);

    sm.update_state(s("dead#1"), AgentState::Ended, s("bash"), a("claude"));
    sm.force_expire_session("dead#1");

    let changed = sm.cleanup_ended();
    assert!(changed);

    let data = sm.get_render_data();
    assert_eq!(data.len(), 1);
    assert_eq!(data[0].session, "alive#1");

    sm.update_state(s("new#1"), AgentState::Started, s("bash"), a("claude"));
    sm.update_workspace("new", 0, 0);

    let data = sm.get_render_data();
    let sessions: Vec<&str> = data.iter().map(|a| a.session.as_str()).collect();
    assert_eq!(sessions, vec!["new#1", "alive#1"]);
    true
}

fn test_stress_1000() -> bool {
    let mut sm = StateManager::new();
    for i in 0..1000 {
        let session = format!("project_{}#{}", i / 10, i % 10);
        let ws = (i / 10) as u32;
        sm.update_state(session.clone(), AgentState::Started, s("bash"), a("claude"));
        sm.update_workspace(&session.split('#').next().unwrap().to_string(), ws, 0);
    }

    let data = sm.get_render_data();
    assert_eq!(data.len(), 1000);

    for i in 0..999 {
        let ws_a = data[i].group;
        let ws_b = data[i + 1].group;
        assert!(ws_a <= ws_b);
    }

    let _ = sm.focus_next();
    true
}

#[test]
fn full_report() {
    let tests: Vec<(&str, fn() -> bool)> = vec![
        ("update_state_awaiting", test_update_state_awaiting),
        ("update_state_left_awaiting", test_update_state_left_awaiting),
        ("update_state_completed_focused", test_update_state_completed_focused),
        ("update_state_ended", test_update_state_ended),
        ("update_window_focus", test_update_window_focus),
        ("cleanup_ended", test_cleanup_ended),
        ("focus_next_deterministic", test_focus_next_deterministic),
        ("focus_next_priority", test_focus_next_priority),
        ("render_data_grouping", test_render_data_grouping),
        ("render_data_sorting", test_render_data_sorting),
        ("render_data_sorting_by_monitor", test_render_data_sorting_by_monitor),
        ("monitor_change_reorders", test_monitor_change_reorders),
        ("auto_focus_should_next", test_auto_focus),
        ("cleanup_preserves_other_workspaces", test_cleanup_preserves_other_workspaces),
        ("stress_1000_sessions", test_stress_1000),
    ];

    let mut results = Vec::new();
    for (name, test_fn) in &tests {
        results.push(run_test(name, test_fn));
    }

    let now = chrono_free_timestamp();
    let mut report = String::new();

    writeln!(report, "=== Argus Agenticus StateManager Test Report ===").unwrap();
    writeln!(report, "Date: {now}").unwrap();
    writeln!(report).unwrap();
    writeln!(
        report,
        "{:>2}  {:<36} {:<8} {:<11} {:<8} {}",
        "#", "Test", "Status", "Time", "Allocs", "Bytes"
    ).unwrap();

    let mut passed = 0u32;
    let mut failed = 0u32;
    for (i, r) in results.iter().enumerate() {
        let status = if r.passed { "PASS" } else { "FAIL" };
        if r.passed { passed += 1; } else { failed += 1; }
        writeln!(
            report,
            "{:>2}  {:<36} {:<8} {:<11} {:<8} {}",
            i + 1,
            r.name,
            status,
            format_time(r.time_ns),
            r.alloc_count,
            r.alloc_bytes
        ).unwrap();
    }

    writeln!(report).unwrap();
    writeln!(report, "Total: {passed} passed, {failed} failed").unwrap();

    let report_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-reports");
    fs::create_dir_all(&report_dir).unwrap();
    let filename = format!("report-{}.txt", now.replace(' ', "_").replace(':', "-"));
    let report_path = report_dir.join(&filename);
    fs::write(&report_path, &report).unwrap();

    writeln!(report, "Report: {}", report_path.display()).unwrap();
    print!("{report}");

    assert_eq!(failed, 0, "{failed} test(s) failed");
}

fn chrono_free_timestamp() -> String {
    let output = std::process::Command::new("date")
        .arg("+%Y-%m-%d %H:%M:%S")
        .output()
        .expect("failed to run date");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}
