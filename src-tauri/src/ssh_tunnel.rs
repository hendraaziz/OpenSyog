use russh::client::{self, Handle};
use russh::keys::key::PublicKey;
use russh::ChannelMsg;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

use crate::saved_conns::SshParams;

struct ClientHandler;

#[async_trait::async_trait]
impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        // TODO fase lanjut: verifikasi known_hosts.
        Ok(true)
    }
}

/// Tunnel SSH aktif: DB lokal port diteruskan ke dest via SSH.
pub struct SshTunnel {
    pub local_port: u16,
    task: JoinHandle<()>,
}

impl SshTunnel {
    pub fn abort(&self) {
        self.task.abort();
    }
}

async fn connect_ssh(params: &SshParams) -> Result<Handle<ClientHandler>, String> {
    // Sertakan algoritma legacy agar kompatibel dengan server SSH lama
    // (KEX SHA1, hostkey ssh-rsa, cipher CBC) — modern tetap diprioritaskan.
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(3600)),
        preferred: russh::Preferred {
            kex: std::borrow::Cow::from(&[
                russh::kex::EXTENSION_SUPPORT_AS_CLIENT,
                russh::kex::CURVE25519,
                russh::kex::CURVE25519_PRE_RFC_8731,
                russh::kex::ECDH_SHA2_NISTP256,
                russh::kex::ECDH_SHA2_NISTP384,
                russh::kex::ECDH_SHA2_NISTP521,
                russh::kex::DH_G16_SHA512,
                russh::kex::DH_G14_SHA256,
                russh::kex::DH_G14_SHA1,
                russh::kex::DH_G1_SHA1,
            ][..]),
            key: std::borrow::Cow::from(&[
                russh::keys::key::RSA_SHA2_256,
                russh::keys::key::RSA_SHA2_512,
                russh::keys::key::ED25519,
                russh::keys::key::ECDSA_SHA2_NISTP256,
                russh::keys::key::ECDSA_SHA2_NISTP384,
                russh::keys::key::ECDSA_SHA2_NISTP521,
                russh::keys::key::SSH_RSA,
            ][..]),
            cipher: std::borrow::Cow::from(&[
                russh::cipher::CHACHA20_POLY1305,
                russh::cipher::AES_256_GCM,
                russh::cipher::AES_256_CTR,
                russh::cipher::AES_192_CTR,
                russh::cipher::AES_128_CTR,
                russh::cipher::AES_256_CBC,
                russh::cipher::AES_192_CBC,
                russh::cipher::AES_128_CBC,
                russh::cipher::TRIPLE_DES_CBC,
            ][..]),
            ..Default::default()
        },
        ..Default::default()
    });

    let mut handle = client::connect(config, (params.host.as_str(), params.port), ClientHandler)
        .await
        .map_err(|e| format!("SSH connect to {}:{} failed: {e}", params.host, params.port))?;

    let authed = if let Some(key_path) = &params.private_key_path {
        let key = russh_keys::load_secret_key(key_path, params.password.as_deref())
            .map_err(|e| format!("load private key failed: {e}"))?;
        handle
            .authenticate_publickey(&params.user, Arc::new(key))
            .await
            .map_err(|e| format!("SSH auth error: {e}"))?
    } else {
        handle
            .authenticate_password(&params.user, params.password.clone().unwrap_or_default())
            .await
            .map_err(|e| format!("SSH auth error: {e}"))?
    };

    if !authed {
        return Err("SSH authentication failed (wrong user/password/key?)".into());
    }
    Ok(handle)
}

/// Buka tunnel: listener di port lokal bebas, trafik diforward ke dest_host:dest_port lewat SSH.
pub async fn open_tunnel(
    params: &SshParams,
    dest_host: &str,
    dest_port: u16,
) -> Result<SshTunnel, String> {
    let mut handle = connect_ssh(params).await?;

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| format!("bind local tunnel port failed: {e}"))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    let dest_host = dest_host.to_string();
    let task = tokio::spawn(async move {
        loop {
            let Ok((tcp, _)) = listener.accept().await else { continue };
            let channel = handle
                .channel_open_direct_tcpip(&dest_host, dest_port.into(), "127.0.0.1", 0)
                .await;
            if let Ok(channel) = channel {
                tokio::spawn(pump(channel, tcp));
            }
        }
    });

    Ok(SshTunnel { local_port, task })
}

/// Pompa dua arah antara channel SSH dan TCP lokal.
async fn pump(mut channel: russh::Channel<russh::client::Msg>, mut tcp: TcpStream) {
    let mut buf = vec![0u8; 16384];
    let mut ssh_closed = false;
    let mut tcp_closed = false;

    while !ssh_closed && !tcp_closed {
        tokio::select! {
            msg = channel.wait() => match msg {
                Some(ChannelMsg::Data { data }) => {
                    if tcp.write_all(&data).await.is_err() {
                        tcp_closed = true;
                    }
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    // stderr dari remote: abaikan tapi tetap konsumsi
                    let _ = &data;
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                    ssh_closed = true;
                }
                _ => {}
            },
            r = tcp.read(&mut buf) => match r {
                Ok(0) => {
                    tcp_closed = true;
                    let _ = channel.eof().await;
                }
                Ok(n) => {
                    if channel.data(&buf[..n]).await.is_err() {
                        ssh_closed = true;
                    }
                }
                Err(_) => {
                    tcp_closed = true;
                    let _ = channel.eof().await;
                }
            }
        }
    }
    let _ = channel.close().await;
    let _ = tcp.shutdown().await;
}
