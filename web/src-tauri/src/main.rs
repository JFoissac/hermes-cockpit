// Coque desktop : la fenêtre charge l'UI servie par Vite en dev, le bundle en prod.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                // Le service local sert l'UI ET l'API sur la même origine : c'est
                // le seul montage où les appels `/api` fonctionnent sans CORS ni
                // base absolue. On y bascule dès qu'il répond, sinon on garde le
                // bundle embarqué (`tauri://localhost`).
                let service = "127.0.0.1:8791"
                    .parse()
                    .ok()
                    .and_then(|addr| {
                        std::net::TcpStream::connect_timeout(
                            &addr,
                            std::time::Duration::from_millis(400),
                        )
                        .ok()
                    });
                if service.is_some() {
                    if let Ok(url) = tauri::Url::parse("http://127.0.0.1:8791/") {
                        let _ = window.navigate(url);
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("échec du démarrage de Hermes Cockpit");
}
