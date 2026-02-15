use std::path::PathBuf;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::task::JoinHandle;

use argus_agenticus::socket::SocketServer;

struct TestServer {
    path: PathBuf,
    handle: JoinHandle<std::io::Result<()>>,
}

impl TestServer {
    async fn start(name: &str) -> Self {
        let dir = std::env::temp_dir().join("argus-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!(
            "{}-{}-{}.sock",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let _ = std::fs::remove_file(&path);

        let server = SocketServer::new(path.clone());
        let handle = tokio::spawn(async move { server.run().await });

        for _ in 0..50 {
            if path.exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(path.exists(), "server socket not created at {:?}", path);

        Self { path, handle }
    }

    async fn connect(&self) -> TestClient {
        let stream = UnixStream::connect(&self.path).await.unwrap();
        let (reader, writer) = stream.into_split();
        TestClient {
            reader: BufReader::new(reader),
            writer,
        }
    }

    async fn shutdown(self) {
        self.handle.abort();
        let _ = self.handle.await;
        let _ = tokio::fs::remove_file(&self.path).await;
    }
}

struct TestClient {
    reader: BufReader<OwnedReadHalf>,
    writer: OwnedWriteHalf,
}

impl TestClient {
    async fn send(&mut self, json: &str) {
        self.writer.write_all(json.as_bytes()).await.unwrap();
        self.writer.write_all(b"\n").await.unwrap();
        self.writer.flush().await.unwrap();
    }

    async fn recv(&mut self) -> serde_json::Value {
        self.recv_timeout(2000)
            .await
            .expect("timeout waiting for response")
    }

    async fn recv_timeout(&mut self, ms: u64) -> Option<serde_json::Value> {
        let mut line = String::new();
        match tokio::time::timeout(
            Duration::from_millis(ms),
            self.reader.read_line(&mut line),
        )
        .await
        {
            Ok(Ok(n)) if n > 0 => Some(serde_json::from_str(line.trim()).unwrap()),
            _ => None,
        }
    }
}

#[tokio::test]
async fn click_returns_focus() {
    let srv = TestServer::start("click").await;
    let mut c = srv.connect().await;

    c.send(r#"{"type":"click","session":"proj#1"}"#).await;
    let resp = c.recv().await;

    assert_eq!(resp["type"], "focus");
    assert_eq!(resp["session"], "proj#1");

    srv.shutdown().await;
}

#[tokio::test]
async fn state_broadcasts_to_extension() {
    let srv = TestServer::start("broadcast").await;
    let mut ext = srv.connect().await;
    let mut agent = srv.connect().await;

    ext.send(r#"{"type":"window_focus","title":"proj - editor"}"#).await;
    tokio::time::sleep(Duration::from_millis(50)).await;

    agent.send(r#"{"type":"state","session":"proj#1","state":"started","tool":"bash"}"#).await;

    let resp = ext.recv().await;
    assert_eq!(resp["type"], "render");
    assert!(resp["agents"].is_array());

    srv.shutdown().await;
}

#[tokio::test]
async fn non_extension_no_broadcast() {
    let srv = TestServer::start("no_broadcast").await;
    let mut plain = srv.connect().await;
    let mut agent = srv.connect().await;

    tokio::time::sleep(Duration::from_millis(50)).await;
    agent.send(r#"{"type":"state","session":"proj#1","state":"started","tool":"bash"}"#).await;

    let resp = plain.recv_timeout(200).await;
    assert!(resp.is_none(), "plain client should not receive broadcast, got {resp:?}");

    srv.shutdown().await;
}

#[tokio::test]
async fn window_focus_makes_extension() {
    let srv = TestServer::start("make_ext").await;
    let mut c = srv.connect().await;
    let mut agent = srv.connect().await;

    let no_msg = c.recv_timeout(100).await;
    assert!(no_msg.is_none(), "should not receive anything before becoming extension");

    c.send(r#"{"type":"idle_status","idle":true}"#).await;
    tokio::time::sleep(Duration::from_millis(50)).await;

    agent.send(r#"{"type":"state","session":"x#1","state":"started","tool":"bash"}"#).await;

    let resp = c.recv().await;
    assert_eq!(resp["type"], "render");

    srv.shutdown().await;
}

#[tokio::test]
async fn focus_next_returns_session() {
    let srv = TestServer::start("focus_next").await;
    let mut c = srv.connect().await;

    c.send(r#"{"type":"state","session":"p#1","state":"started","tool":"bash"}"#).await;
    tokio::time::sleep(Duration::from_millis(50)).await;

    c.send(r#"{"type":"focus_next"}"#).await;

    let resp = c.recv().await;
    assert_eq!(resp["type"], "focus");
    assert_eq!(resp["session"], "p#1");

    srv.shutdown().await;
}

#[tokio::test]
async fn invalid_json_survives() {
    let srv = TestServer::start("invalid_json").await;
    let mut c = srv.connect().await;

    c.send("this is not json at all").await;
    c.send(r#"{"type":"totally_unknown","foo":"bar"}"#).await;
    c.send(r#"{"broken json"#).await;

    c.send(r#"{"type":"click","session":"ok#1"}"#).await;
    let resp = c.recv().await;

    assert_eq!(resp["type"], "focus");
    assert_eq!(resp["session"], "ok#1");

    srv.shutdown().await;
}

#[tokio::test]
async fn oversize_line_dropped() {
    let srv = TestServer::start("oversize").await;
    let mut c = srv.connect().await;

    let huge = "x".repeat(70_000);
    c.send(&huge).await;

    c.send(r#"{"type":"click","session":"after_huge#1"}"#).await;
    let resp = c.recv().await;

    assert_eq!(resp["type"], "focus");
    assert_eq!(resp["session"], "after_huge#1");

    srv.shutdown().await;
}

#[tokio::test]
async fn empty_lines_ignored() {
    let srv = TestServer::start("empty_lines").await;
    let mut c = srv.connect().await;

    c.send("").await;
    c.send("   ").await;
    c.send("\t").await;

    c.send(r#"{"type":"click","session":"e#1"}"#).await;
    let resp = c.recv().await;

    assert_eq!(resp["type"], "focus");
    assert_eq!(resp["session"], "e#1");

    srv.shutdown().await;
}

#[tokio::test]
async fn window_focus_with_agent_type() {
    let srv = TestServer::start("agent_type_focus").await;
    let mut ext = srv.connect().await;
    let mut agent = srv.connect().await;

    ext.send(r#"{"type":"idle_status","idle":true}"#).await;
    tokio::time::sleep(Duration::from_millis(50)).await;

    agent.send(r#"{"type":"state","session":"cursor#c-abc","state":"completed","tool":"Shell","agent_type":"cursor"}"#).await;
    let render = ext.recv().await;
    assert_eq!(render["agents"][0]["state"], "completed");

    ext.send(r#"{"type":"window_focus","title":"file.ts - SomeProject - Cursor","agent_type":"cursor"}"#).await;
    let render = ext.recv().await;
    assert_eq!(render["agents"][0]["state"], "started");

    srv.shutdown().await;
}

#[tokio::test]
async fn click_returns_agent_type() {
    let srv = TestServer::start("click_agent_type").await;
    let mut c = srv.connect().await;

    c.send(r#"{"type":"state","session":"proj#c-abc","state":"started","tool":"Shell","agent_type":"cursor"}"#).await;
    tokio::time::sleep(Duration::from_millis(50)).await;

    c.send(r#"{"type":"click","session":"proj#c-abc"}"#).await;
    let resp = c.recv().await;

    assert_eq!(resp["type"], "focus");
    assert_eq!(resp["session"], "proj#c-abc");
    assert_eq!(resp["agent_type"], "cursor");

    srv.shutdown().await;
}

#[tokio::test]
async fn repeated_click_same_session() {
    let srv = TestServer::start("repeated_click").await;
    let mut c = srv.connect().await;

    c.send(r#"{"type":"state","session":"proj#s1","state":"started","tool":"bash","agent_type":"claude"}"#).await;
    c.send(r#"{"type":"state","session":"proj#s2","state":"started","tool":"bash","agent_type":"claude"}"#).await;
    tokio::time::sleep(Duration::from_millis(50)).await;

    for _ in 0..5 {
        c.send(r#"{"type":"click","session":"proj#s1"}"#).await;
        let resp = c.recv().await;
        assert_eq!(resp["type"], "focus");
        assert_eq!(resp["session"], "proj#s1");
        assert_eq!(resp["agent_type"], "claude");
    }

    srv.shutdown().await;
}

#[tokio::test]
async fn concurrent_clients() {
    let srv = TestServer::start("concurrent").await;
    let mut c1 = srv.connect().await;
    let mut c2 = srv.connect().await;

    c1.send(r#"{"type":"click","session":"alpha#1"}"#).await;
    c2.send(r#"{"type":"click","session":"beta#1"}"#).await;

    let r1 = c1.recv().await;
    let r2 = c2.recv().await;

    assert_eq!(r1["type"], "focus");
    assert_eq!(r1["session"], "alpha#1");
    assert_eq!(r2["type"], "focus");
    assert_eq!(r2["session"], "beta#1");

    srv.shutdown().await;
}
