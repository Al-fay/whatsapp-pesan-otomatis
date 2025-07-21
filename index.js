const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const mysql = require("mysql2/promise");

// === Error Handler Global ===
process.on("uncaughtException", (err) => {
  console.error("🔥 Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("🔥 Unhandled Rejection:", reason);
});

// === Waktu Indonesia (WIB) ===
function getJamIndonesia() {
  const formatter = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(formatter.format(new Date()));
}

function isWaktuAktif() {
  const jam = getJamIndonesia();
  return jam >= 6 || jam < 1; // Aktif dari jam 06:00 - 00:59 WIB
}

// === Socket WhatsApp ===
let sock = null;

async function connectToWhatsApp() {
  try {
    if (!isWaktuAktif()) {
      console.log("⏰ Di luar jam operasional. Menunggu waktu aktif...");
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
        console.log("📲 Scan QR untuk login WhatsApp:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        console.log("✅ Terhubung ke WhatsApp");
        kirimPesanDariDatabase(sock);

        setInterval(() => {
          if (isWaktuAktif()) {
            kirimPesanDariDatabase(sock);
          } else {
            console.log("⏳ Di luar jam aktif. Tidak kirim pesan.");
          }
        }, 60000);
      }

      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        const reason = DisconnectReason[code] || "Unknown reason";
        console.log(`❌ Koneksi tertutup. Alasan: ${reason}`);

        if (code !== DisconnectReason.loggedOut) {
          console.log("🔁 Mencoba reconnect...");
          setTimeout(connectToWhatsApp, 5000);
        } else {
          console.log("⚠️ Telah logout. Scan ulang QR jika perlu.");
        }
      }
    });
  } catch (err) {
    console.error("❌ Gagal konek WhatsApp:", err.message);
  }
}

// === Kirim Pesan Otomatis ===
async function kirimPesanDariDatabase(sock) {
  try {
    const db = await mysql.createConnection({
      host: "localhost",
      user: "root",
      password: "",
      database: "db_whatsapp",
    });

    const [rows] = await db.execute(
      "SELECT nomor, pesan FROM pesan_otomatis WHERE status = 0"
    );

    for (const row of rows) {
      const nomor = row.nomor + "@s.whatsapp.net";
      try {
        await sock.sendMessage(nomor, { text: row.pesan });
        console.log(`📤 Pesan terkirim ke ${row.nomor}`);
        await db.execute(
          "UPDATE pesan_otomatis SET status = 1 WHERE nomor = ?",
          [row.nomor]
        );
      } catch (err) {
        console.error(`⚠️ Gagal kirim ke ${row.nomor}:`, err.message);
      }
    }

    await db.end();
  } catch (err) {
    console.error("❌ Gagal koneksi ke database:", err.message);
  }
}

// === Reconnect Otomatis Setiap 2 Menit ===
let reconnectTimer = null;
function startReconnectLoop() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(() => {
    const jam = getJamIndonesia();

    if (isWaktuAktif() && (!sock || sock?.ws?.readyState !== 1)) {
      console.log(`🔁 [${jam}:00 WIB] Mencoba reconnect...`);
      connectToWhatsApp();
    }

    if (!isWaktuAktif() && sock) {
      console.log(`🌙 [${jam}:00 WIB] Di luar jam aktif, memutus koneksi...`);
      sock.end();
      sock = null;
    }
  }, 2 * 60 * 1000); // tiap 2 menit
}

// === Mulai Program ===
connectToWhatsApp();
startReconnectLoop();
