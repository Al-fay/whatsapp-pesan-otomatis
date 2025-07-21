const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const mysql = require("mysql2/promise");

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📲 Scan QR ini untuk login WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("Terhubung ke WhatsApp");
      kirimPesanDariDatabase(sock);
      setInterval(() => {
        kirimPesanDariDatabase(sock);
      }, 60000);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = DisconnectReason[statusCode] || "Unknown reason";
      console.log(`Koneksi tertutup. Alasan: ${reason}`);

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log("Mencoba reconnect...");
        connectToWhatsApp();
      } else {
        console.log("Telah logout dari perangkat, silakan scan ulang QR");
      }
    }
  });
}

// Fungsi kirim pesan dari database
async function kirimPesanDariDatabase(sock) {
  try {
    const connection = await mysql.createConnection({
      host: "localhost",
      user: "root",
      password: "",
      database: "db_whatsapp",
    });

    const [rows] = await connection.execute(
      "SELECT nomor, pesan FROM pesan_otomatis WHERE status = 0"
    );

    for (const row of rows) {
      const nomor = row.nomor + "@s.whatsapp.net";
      try {
        await sock.sendMessage(nomor, { text: row.pesan });
        console.log(`Pesan terkirim ke ${row.nomor}`);

        await connection.execute(
          "UPDATE pesan_otomatis SET status = 1 WHERE nomor = ?",
          [row.nomor]
        );
      } catch (err) {
        console.error(`Gagal kirim ke ${row.nomor}:`, err.message);
      }
    }

    await connection.end();
  } catch (err) {
    console.error("Gagal koneksi ke database:", err.message);
  }
}

// Jalankan
connectToWhatsApp();
