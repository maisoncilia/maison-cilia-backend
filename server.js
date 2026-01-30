const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const Stripe = require("stripe");
const nodemailer = require("nodemailer");

/* =====================
   CONFIG
===================== */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Maha123@";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5500";

/* =====================
   STRIPE
===================== */
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* =====================
   EMAIL (BREVO SMTP)
===================== */
const mailer = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_USER,
    pass: process.env.BREVO_PASS
  }
});

/* =====================
   APP
===================== */
const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

/* =====================
   ROUTE TEST (RENDER)
===================== */
app.get("/", (req, res) => {
  res.send("Backend Maison Cilia OK 🚀");
});

const DATA_FILE = path.join(__dirname, "data.json");

/* =====================
   UTILS DATA
===================== */
function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* =====================
   CALENDRIER (CLIENT)
===================== */
app.get("/calendar", (req, res) => {
  const data = readData();
  res.json(data.slots);
});

/* =====================
   STRIPE CHECKOUT
===================== */
app.post("/create-checkout", async (req, res) => {
  const { date, time, firstName, lastName, email, service } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      customer_email: email || undefined,

      metadata: {
        firstName,
        lastName,
        service,
        date,
        time
      },

      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: 1000, // 10 €
            product_data: {
              name: "Acompte rendez-vous — Maison Cilia",
              description: `${service} | ${date} à ${time}`
            }
          },
          quantity: 1
        }
      ],

      success_url:
        `${FRONTEND_URL}/success.html` +
        `?date=${date}` +
        `&time=${time}` +
        `&service=${encodeURIComponent(service)}` +
        `&firstName=${firstName}` +
        `&lastName=${lastName}` +
        `&email=${email || ""}`,

      cancel_url: `${FRONTEND_URL}/booking.html`
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: "Erreur Stripe" });
  }
});

/* =====================
   CONFIRMATION + EMAIL
===================== */
app.post("/confirm", async (req, res) => {
  const { date, time, firstName, lastName, email, service } = req.body;
  const data = readData();

  const slot = data.slots.find(
    s => s.date === date && s.time === time
  );

  if (!slot || slot.booked) {
    return res.status(400).json({ error: "Créneau indisponible" });
  }

  // Marquer réservé
  slot.booked = true;
  slot.client = { firstName, lastName, email, service };
  writeData(data);

  // Email confirmation
  if (email) {
    try {
      await mailer.sendMail({
        from: "Maison Cilia <contact@maisoncilia.com>",
        to: email,
        subject: "✨ Confirmation de votre rendez-vous — Maison Cilia",
        html: `
          <h2>Bonjour ${firstName},</h2>

          <p>Votre rendez-vous est <strong>confirmé</strong> ✨</p>

          <p>
            <strong>Prestation :</strong> ${service}<br>
            <strong>Date :</strong> ${date}<br>
            <strong>Heure :</strong> ${time}<br><br>
            <strong>Adresse :</strong><br>
            Ivry-sur-Seine, Paris
          </p>

          <p>
            Merci pour votre confiance 💖<br>
            <strong>Maison Cilia</strong>
          </p>
        `
      });
    } catch (err) {
      console.error("Erreur email :", err);
    }
  }

  res.json({ success: true });
});

/* =====================
   ADMIN – RÉSERVATIONS
===================== */
app.get("/admin/reservations", (req, res) => {
  if (req.headers.authorization !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Accès refusé" });
  }

  const data = readData();
  res.json(data.slots);
});

/* =====================
   ADMIN – AJOUT SLOT
===================== */
app.post("/admin/add-slot", (req, res) => {
  if (req.headers.authorization !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Accès refusé" });
  }

  const { date, time } = req.body;
  const data = readData();

  data.slots.push({
    date,
    time,
    booked: false,
    client: null
  });

  writeData(data);
  res.json({ success: true });
});

/* =====================
   ADMIN – SUPPRIMER SLOT
===================== */
app.post("/admin/delete-slot", (req, res) => {
  if (req.headers.authorization !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Accès refusé" });
  }

  const { date, time } = req.body;
  const data = readData();

  data.slots = data.slots.filter(
    s => !(s.date === date && s.time === time)
  );

  writeData(data);
  res.json({ success: true });
});

/* =====================
   START SERVER
===================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Backend Maison Cilia lancé sur le port", PORT);
});
