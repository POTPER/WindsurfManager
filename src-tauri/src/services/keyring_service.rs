use base64::{engine::general_purpose::STANDARD, Engine};
use keyring::Entry;
use rand::RngCore;
use tracing::info;

const SERVICE_NAME: &str = "WindsurfManager";
const KEY_NAME: &str = "MasterKey";

pub fn get_or_create_passphrase() -> anyhow::Result<String> {
    let entry = Entry::new(SERVICE_NAME, KEY_NAME)?;

    match entry.get_password() {
        Ok(passphrase) => {
            info!("Master passphrase loaded from keyring");
            Ok(passphrase)
        }
        Err(keyring::Error::NoEntry) => {
            let passphrase = generate_passphrase();
            entry.set_password(&passphrase)?;
            info!("New master passphrase generated and stored in keyring");
            Ok(passphrase)
        }
        Err(e) => Err(anyhow::anyhow!("Failed to access keyring: {}", e)),
    }
}

fn generate_passphrase() -> String {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    STANDARD.encode(key)
}
