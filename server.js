const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const nodemailer = require("nodemailer");
const mongoose = require("mongoose");

/* =====================
   ENV
===================== */
const {
  PORT = 3000,
  STRIPE_SECRET_KEY,
  EMAIL_USER,
  EMAIL_PASS,
  ADMIN_PASSWORD,
  FRONTEND_URL,
  MONGODB_URI
} = process.env;

/* =====================
   VERIFICATION ENV
===================== */
if (
  !STRIPE_SECRET_KEY ||
  !EMAIL_USER ||
  !EMAIL_PASS ||
  !ADMIN_PASSWORD ||
  !FRONTEND_URL ||
  !MONGODB_URI
) {
  console.error("❌ Variables d'environnement manquantes");
  process.exit(1);
}

/* =====================
   MONGODB
===================== */
mongoose
  .connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000
  })
  .then(() => console.log("✅ MongoDB connecté"))
  .catch(err => {
    console.error("❌ Erreur MongoDB :", err);
    process.exit(1);
  });

const SlotSchema = new mongoose.Schema({
  date: { type: String, required: true },
  time: { type: String, required: true },
  booked: { type: Boolean, default: false },
  client: {
    firstName: String,
    lastName: String,
    email: String,
    service: String
  }
});

/* 👉 empêche les doublons */
SlotSchema.index({ date: 1, time: 1 }, { unique: true });

const Slot = mongoose.model("Slot", SlotSchema);

/* =====================
   STRIPE
===================== */
const stripe = Stripe(STRIPE_SECRET_KEY);

/* =====================
   EMAIL (GMAIL)
===================== */
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
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
   TEST ROUTE
===================== */
app.get("/", (req, res) => {
  res.send("Backend Maison Cilia OK 🚀");
});

/* =====================
   CALENDAR (CLIENT)
===================== */
app.get("/calendar", async (req, res) => {
  try {
    const slots = await Slot.find().sort({ date: 1, time: 1 });
    res.json(slots);
  } catch (err) {
    res.status(500).json({ error: "Erreur calendrier" });
  }
});

/* =====================
   STRIPE CHECKOUT
===================== */
app.post("/create-checkout", async (req, res) => {
  const { date, time, firstName, lastName, email, service } = req.body;

  if (!date || !time || !firstName || !lastName || !service) {
    return res.status(400).json({ error: "Données manquantes" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email || undefined,

      metadata: {
        date,
        time,
        service,
        firstName,
        lastName
      },

      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: 1000,
            product_data: {
              name: "Acompte — Maison Cilia",
              description: `${service} | ${date} à ${time}`
            }
          },
          quantity: 1
        }
      ],

      success_url:
        `${FRONTEND_URL}/success.html` +
        `?date=${encodeURIComponent(date)}` +
        `&time=${encodeURIComponent(time)}` +
        `&service=${encodeURIComponent(service)}` +
        `&firstName=${encodeURIComponent(firstName)}` +
        `&lastName=${encodeURIComponent(lastName)}` +
        `&email=${encodeURIComponent(email || "")}`,

      cancel_url: `${FRONTEND_URL}/booking.html`
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("❌ Stripe error :", err);
    res.status(500).json({ error: "Erreur Stripe" });
  }
});

/* =====================
   CONFIRM RESERVATION
===================== */
app.post("/confirm", async (req, res) => {
  const { date, time, firstName, lastName, email, service } = req.body;

  try {
    const slot = await Slot.findOne({ date, time });

    if (!slot || slot.booked) {
      return res.status(400).json({ error: "Créneau indisponible" });
    }

    slot.booked = true;
    slot.client = { firstName, lastName, email, service };
    await slot.save();

    if (email) {
      try {
        await mailer.sendMail({
          from: `Maison Cilia <${EMAIL_USER}>`,
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
            <p>Merci pour votre confiance 💖<br><strong>Maison Cilia</strong></p>
          `
        });
      } catch (mailErr) {
        console.error("⚠️ Erreur email :", mailErr);
      }
    }

    res.json({ success: true });

  } catch (err) {
    console.error("❌ Confirm error :", err);
    res.status(500).json({ error: "Erreur confirmation" });
  }
});

/* =====================
   ADMIN – LISTE
===================== */
app.get("/admin/reservations", async (req, res) => {
  if (req.headers.authorization !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Accès refusé" });
  }

  const slots = await Slot.find().sort({ date: 1, time: 1 });
  res.json(slots);
});

/* =====================
   ADMIN – AJOUT SLOT
===================== */
app.post("/admin/add-slot", async (req, res) => {
  if (req.headers.authorization !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Accès refusé" });
  }

  const { date, time } = req.body;
  if (!date || !time) {
    return res.status(400).json({ error: "Date/heure manquantes" });
  }

  try {
    await Slot.create({ date, time });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "Créneau déjà existant" });
  }
});

/* =====================
   ADMIN – SUPPRIMER SLOT
===================== */
app.post("/admin/delete-slot", async (req, res) => {
  if (req.headers.authorization !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Accès refusé" });
  }

  const { date, time } = req.body;
  await Slot.deleteOne({ date, time });
  res.json({ success: true });
});

/* =====================
   START SERVER
===================== */
app.listen(PORT, () => {
  console.log(`🚀 Backend lancé sur le port ${PORT}`);
});
