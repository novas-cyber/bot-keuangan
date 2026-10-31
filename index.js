const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const UNIVERSAL_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbyQFI6i-TjF-YOzH48-_1BRw0lh1-F16NMKB6v45kpyUQmXvUNAjcsU9gJEYinb2t8C";

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("👉 Scan QR Code di bawah ini menggunakan WhatsApp di HP kamu:");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ Bot WhatsApp berhasil terhubung dan aktif!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        const args = text.trim().split(' ');
        const command = args[0].toLowerCase();

        if (command === 'masuk' || command === 'keluar') {
            const nominal = args[1];
            const keterangan = args.slice(2).join(' ');

            if (!nominal || isNaN(nominal) || !keterangan) {
                await sock.sendMessage(sender, { 
                    text: "Format salah!\nGunakan:\n• masuk [nominal] [keterangan]\n• keluar [nominal] [keterangan]" 
                });
                return;
            }

            const now = new Date();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const year = now.getFullYear();
            const bulanTahunKey = `${month}-${year}`;

            let payload = { 
                bulanTahun: bulanTahunKey,
                keterangan: keterangan 
            };
            if (command === 'masuk') payload.pemasukan = nominal;
            if (command === 'keluar') payload.pengeluaran = nominal;

            try {
                await fetch(UNIVERSAL_WEBAPP_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                
                await sock.sendMessage(sender, { 
                    text: `✅ Berhasil dicatat (${bulanTahunKey}):\n${command.toUpperCase()} Rp${Number(nominal).toLocaleString('id-ID')} (${keterangan})` 
                });
            } catch (err) {
                await sock.sendMessage(sender, { text: "❌ Gagal menyimpan ke laporan keuangan." });
            }
        }
    });
}

connectToWhatsApp();