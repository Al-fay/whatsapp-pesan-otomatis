const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const mysql = require("mysql2/promise");

// Cek apakah dalam rentang jam 06:00 - 01:00
function isWaktuAktif() {
  const now = new Date();
  const jam = now.getHours();
  return jam >= 6 && jam < 24; // aktif dari jam 6 sampai sebelum jam 1 pagi
}

// Simpan referensi ke socket
let sock = null;

async function connectToWhatsApp() {
  if (!isWaktuAktif()) {
    console.log("⏰ Di luar jam operasional. Akan mencoba lagi nanti.");
    setTimeout(connectToWhatsApp, 10 * 60 * 1000); // Coba lagi 10 menit kemudian
    return;
  }

  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

  sock = makeWASocket({
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
      console.log("✅ Terhubung ke WhatsApp");

      // Kirim pesan hanya jika dalam waktu aktif
      if (isWaktuAktif()) {
        kirimPesanDariDatabase(sock);
        setInterval(() => {
          if (isWaktuAktif()) {
            kirimPesanDariDatabase(sock);
          } else {
            console.log("⏳ Di luar jam aktif. Tidak mengirim pesan.");
          }
        }, 60000);
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = DisconnectReason[statusCode] || "Unknown reason";
      console.log(`❌ Koneksi tertutup. Alasan: ${reason}`);

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log("🔁 Mencoba reconnect...");
        setTimeout(connectToWhatsApp, 5000);
      } else {
        console.log("⚠️ Telah logout dari perangkat, silakan scan ulang QR");
      }
    }
  });
}

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
        console.log(`📤 Pesan terkirim ke ${row.nomor}`);

        await connection.execute(
          "UPDATE pesan_otomatis SET status = 1 WHERE nomor = ?",
          [row.nomor]
        );
      } catch (err) {
        console.error(`⚠️ Gagal kirim ke ${row.nomor}:`, err.message);
      }
    }

    await connection.end();
  } catch (err) {
    console.error("❌ Gagal koneksi ke database:", err.message);
  }
}

// Jalankan saat startup
connectToWhatsApp();

// Cek dan restart koneksi setiap 10 menit jika waktu sudah masuk jam aktif
setInterval(() => {
  const now = new Date();
  const jam = now.getHours();
  const menit = now.getMinutes();

  if (isWaktuAktif() && !sock) {
    console.log("🔔 Jam aktif terdeteksi. Menyambungkan ulang...");
    connectToWhatsApp();
  }

  if (!isWaktuAktif() && sock) {
    console.log("🌙 Di luar jam aktif. Memutus koneksi WhatsApp...");
    sock.end();
    sock = null;
  }
}, 10 * 60 * 1000); // Setiap 10 menit
