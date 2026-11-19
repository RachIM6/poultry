# Benchmark: digital poultry solutions (Morocco and nearby markets)

_Research date: 26 Oct 2026. Sources are listed at the end. Feature details come from each vendor's public website. Nothing below was tested hands-on._

## 1. Key finding

The Moroccan market is **almost empty**. **Poultry.ma** is the only full farm-management SaaS built for Morocco that I could find. Everything else is one of these:
- a **neighbouring product** that does one part of the chain (distribution, vet booking, news),
- a **project at an early stage** (Market Dawajin, Better Apps),
- a **foreign tool** (West Africa, Tunisia, or global hardware vendors).

## 2. Who is out there

| # | Solution | Country | Category | Maturity |
|---|----------|---------|----------|----------|
| 1 | **Poultry.ma** | 🇲🇦 Morocco | Farm management SaaS + marketplace + ONSSA services | Live, paid plans |
| 2 | **Market Dawajin** | 🇲🇦 Morocco (UM6P Ventures) | Farm-gate buy/sell + price transparency | Startup, early stage |
| 3 | **Better Apps** | 🇲🇦 Safi | "Application for managing poultry farms" (directory listing) | SARL founded 2021, <10 staff, no public product found |
| 4 | **TikVet** | 🇲🇦 Morocco | Vet booking, teleconsultation, AI assistant, stock | Live |
| 5 | **Aviculture au Maroc** | 🇲🇦 Morocco | Info portal: news, regional prices, classifieds, guides | Live, ads-based |
| 6 | **FISA daily price SMS** | 🇲🇦 Morocco | Daily broiler/egg price broadcast by SMS | Legacy service |
| 7 | **Dawajin Pro** | 🇹🇳 Tunisia | Distribution ERP (orders, deliveries, invoicing, debts) | Live, paid plans |
| 8 | **Jawdi** | 🇸🇳 Senegal | Farm management, mobile-first, offline, AI dictation | Free pilot |
| 9 | **Kolonell** | 🇸🇳 Senegal | Poultry tracking software (agency product) | Live |
| 10 | **Dwagen / دواجن اون لاين** | 🇪🇬 Egypt | Arabic sector marketplace with 7 user types | Competition project |
| 11 | Global references: Big Dutchman BigFarmNet, Munters/Rotem controllers, Fancom eYeNamic, Cainthus, Farmbrite, Odoo poultry module | 🌍 | Barn hardware + cloud, computer vision, generic farm ERP | Mature, expensive, not localized |

## 3. Detailed analysis

### 3.1 Poultry.ma: the direct competitor

**Positioning:** "The first Moroccan platform for managing poultry farms, from the egg to the sale." It is in Arabic first, with French available. Prices are in DH.

**Features**

| Module | What they do |
|---|---|
| Hatchery | Incubation batches, hatch date computed automatically (21 days for chicken, 28 for duck), daily logs of temperature, humidity and egg turning, egg lots from several sources, hatch rate, automatic transfer of chicks to nursery and then to flock |
| Flocks | Broiler, layer, duck, goose, turkey. Daily tracking of eggs, mortality, sales and feed. Feed conversion (IC) and survival rate. Comparison across flocks and cycles, trend charts |
| Health | Ready-made vaccine protocols (Newcastle, Gumboro, Marek, pox and others), schedule generated when a flock is created, treatment log, **ONSSA-compliant vaccination register** |
| Stock | 7 categories (feed, medicines, vaccines, bedding and more). Stock is deducted automatically when daily tracking is entered. Low-stock alerts, cost per flock |
| Finance | Income and expenses collected automatically, plus manual costs (salaries, electricity). 23 default categories, margin per flock and per cycle |
| Reports | Financial statement, technical sheet per flock, PDF export, JSON export (GDPR), weekly and monthly reports by email |
| Notifications | Email, **WhatsApp** (UltraMsg), PWA push, quiet hours, weekly summary |
| IoT | "Smart hatchery": ESP32 sensors for temperature and humidity, with WhatsApp alerts |
| AI | Price estimation and educational articles |
| Extras | Vet guide, hygiene and disinfection reminders, printable QR card per flock (A5), **free Souk** (0% commission, contact by WhatsApp) |
| ONSSA services | Licensing files, feasibility studies, HACCP and pest control, through the partner Rénova Ultra Services |
| Mobile | PWA only (installable). Offline mode covers browsing only |

**Pricing**

| Plan | Price | Limits |
|---|---|---|
| Free | 0 DH | 2 flocks / 100 birds |
| Pro | 120 DH/month or 999 DH/year | 10 flocks / 1,000 birds, WhatsApp, PDF |
| Gold | 250 DH/month or 1,800 DH/year | Unlimited, API, 24/7 support |

**Strengths**
- Covers the full cycle.
- Localized: Arabic, WhatsApp, ONSSA.
- Free tier.
- Revenue also comes from ONSSA services.

**Weaknesses and gaps I noticed**
- The bird caps are very low for real broiler farms. A typical Moroccan broiler house holds 5,000 to 20,000+ birds, so 1,000 birds on Pro is too small. The pricing seems aimed at hobby and small traditional farms.
- **No weight tracking or growth curves compared with strain standards** (Ross, Cobb). No EPEF (production efficiency factor), only IC.
- **No multi-user, roles or workers. No multi-farm or integrator view.**
- **Data cannot be entered offline**, even though weak internet is the #1 barrier on Moroccan farms (IAV study).
- IoT is DIY ESP32 for the hatchery only. There is no link to the barn controllers farmers already own (Rotem, Munters, Fancom).
- No native app, and no voice or Darija entry.
- The Souk is just classifieds with contact by WhatsApp. It has no live price index and no buyer network.
- The legal entity is not named on the site, and the features page and the homepage are not consistent (IoT and AI appear on the homepage but not on the features page).

#### Hands-on walkthrough (public pages, 26 Oct 2026)

**Pricing page contradicts itself**

| Plan | Plan cards say | Comparison table says |
|---|---|---|
| Free | 2 flocks / 100 birds | 1 flock / 50 birds |
| Pro | 10 flocks / 1,000 birds | 50 flocks / 500 birds |

- Either way, the bird caps are tiny for broiler farms.
- The table also locks the "ONSSA reports" behind Pro.
- Payment is **bank transfer or CMI only**. Card payment inside the app is "coming soon". Plan changes take effect the next month.

**Testimonials are not credible as written.** A "Pro" farmer has 3,000 birds and a "Gold" one has 15,000 birds, which the Pro limits don't allow. The numbers look polished ("+18% margin", "ONSSA approval in 1 month"), so they are probably illustrative.

**The Souk does not match what the site promises**
- The homepage promises a souk for birds, fertile eggs and equipment. In reality it holds **about 10 products from 3 sellers**: SAOAS Agro (feed, Marrakech), DerPest Solutions (vaccines and sprayers), and Rénova Ultra Services, which is their own ONSSA partner (disinfection, vet visits at 800 DH/month).
- The **chicks and hatching eggs** categories are **empty (0)**. In practice it is a small supplier catalogue, not a farmer-to-farmer market.

**About page:** the founders say they are poultry farmers who built the tool for their own farm. They position it as Arabic, simple, in DH, and against "English, expensive, built for industrial farms". **No company or team names are given.**

**"How it works" page**
- Onboarding takes 6 steps: account → first flock (7 species, 30+ standard strains, vaccine plan generated automatically) → daily entry ("1 minute") → alerts (vaccine due, low stock, **high mortality**, hatch coming soon) → 4 PDF report types → comparing cycles.

**Signup form** (`/auth/register.php`)
- Fields: full name, email, **WhatsApp number** (06… / +212), password ×2, city (optional), plan picker, terms checkbox.
- It uses a honeypot field against bots. There is **no visible reCAPTCHA**, even though the homepage claims one.
- It is followed by an OTP sent by WhatsApp or email.
- **No questions about the farm** (type, size, species) at signup. There is no phone-only or Google signup, and email is mandatory, which can be a barrier for rural farmers.

### 3.2 Market Dawajin (UM6P Ventures)

- **Value proposition:** organize buying and selling at the farm gate, make selling prices transparent to raise farmers' margins, and use the collected data to give management insights.
- **Why it matters:** this attacks the sector's biggest pain point today. In 2025–2026, live broiler sold for about 7 to 9 DH/kg at the farm while the cost to produce it was about 15 DH/kg. Farmers lose 2 to 3 DH/kg, and there are too many intermediaries (Medias24, Le360, Infomédiaire).
- **Status:** no public product found. Team pages are behind a password.

### 3.3 Better Apps (Safi)

- Its registered activity is "application for managing poultry farms." It is a SARL with 100k DH of capital, founded in 2021.
- I found no website, store listing or product name. It may be a dormant or B2B project. **Worth a call to qualify it.**

### 3.4 TikVet

- Vet directory and **appointment booking** (it calls itself the leader in Morocco), plus chat and remote consultation, an AI assistant, stock management, an installable app, and articles (including a poultry project simulator).
- It is **horizontal** (pets and livestock) and not poultry-specific. It could be a **partner** for a "call a vet" feature rather than a competitor.

### 3.5 Aviculture au Maroc (avicultureaumaroc.com)

- Content portal: news, **regional price listings**, classifieds, jobs, feasibility studies, a vet directory, PDF technical guides and disease pages.
- It shows the demand for **prices + information + classifieds**, but there is no tooling at all, it is web 1.0, and it is paid for by ads.

### 3.6 FISA (the interprofession)

- It broadcasts the **daily broiler and egg price by SMS**, runs the Dawajine trade fair, and has regional delegates since 2025 under the 2023–2030 contract-programme.
- It has no app. **It is a potential partner or data source, not a competitor.**

### 3.7 Dawajin Pro (Tunisia): the downstream model

- An ERP for **poultry distributors**: clients with their own prices and credit limits, field orders, delivery rounds with driver assignment and a map, invoices with **weighing-gap handling**, **debt alerts that block orders when the limit is exceeded**, margins, and Excel export.
- **Pricing:** free tier, 290 DT/year (Starter), 590 DT/year (Pro, up to 5 users), Enterprise on quote.
- **No equivalent exists in Morocco.** This is a whole segment (traders and distributors of live poultry) that nobody serves.

### 3.8 Jawdi (Senegal): best practices on the farm side

- Daily headcount, mortality, feed and **weighings, with growth curves**. Vaccine schedules **by strain** with **withdrawal periods**. Feed formulas, purchase orders, sales with customer debts, P&L per batch.
- **Mobile-first, works offline and syncs later, AI assistant with dictation.**
- A **cooperative / feed supplier** channel: they equip their member farmers at a network rate.
- It is free during the pilot.

### 3.9 Kolonell (Senegal)

- Layers: laying rate. Broilers: weight curve + FCR. **Alerts when thresholds drift.** A **multi-building dashboard**. Offline mobile entry.
- About 10k to 30k FCFA per month (about 160 to 480 DH).

### 3.10 Dwagen (Egypt)

- An Arabic **marketplace for the whole sector with 7 user types**: farmers, traders and distributors, slaughterhouses, hatcheries, vet drug suppliers, equipment suppliers, feed suppliers. It aims to fix pricing. Built in Flutter.
- It is the closest reference for a multi-sided "sector network" in Arabic.

### 3.11 Global references (inspiration, not real competitors)

- **Barn controllers + cloud** (Big Dutchman BigFarmNet, Munters/Rotem, Fancom): climate, water, feed and weighing scales in real time. These are already installed in modern Moroccan houses, and integrating with them is an advantage.
- **Computer vision** (Fancom eYeNamic, Cainthus, Chicams): cameras estimate weight and behaviour.
- **Generic ERPs** (Farmbrite, AgriWebb, the Odoo poultry module): broad, but not localized and not in Arabic or Darija.

## 4. Feature matrix

✅ = yes · ◐ = partial · ❌ = no or not found

| Feature | Poultry.ma | Jawdi | Kolonell | Dawajin Pro | Market Dawajin | TikVet |
|---|---|---|---|---|---|---|
| Daily flock tracking (mortality, feed) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Weight / growth curve vs standard | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| FCR / IC | ✅ | ◐ | ✅ | ❌ | ❌ | ❌ |
| Hatchery / incubation | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vaccination schedule | ✅ | ✅ (by strain + withdrawal) | ❌ | ❌ | ❌ | ❌ |
| Stock with auto-deduction | ✅ | ✅ | ❌ | ✅ | ❌ | ◐ |
| P&L per batch | ✅ | ✅ | ◐ | ✅ (margins) | ❌ | ❌ |
| Sales / customer debts | ◐ | ✅ | ❌ | ✅ | ◐ | ❌ |
| Threshold alerts | ◐ (stock, vaccines) | ✅ | ✅ | ✅ (debts) | ❌ | ❌ |
| Multi-farm / multi-user | ❌ | ◐ | ✅ | ✅ | ❌ | ❌ |
| Offline data entry | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Native mobile app | ❌ (PWA) | soon | ✅ | ✅ | ? | ✅ |
| WhatsApp notifications | ✅ | ❌ | ❌ | ❌ | ? | ❌ |
| Voice / AI assistant | ◐ (price estimation) | ✅ (dictation) | ❌ | ❌ | ? | ✅ |
| IoT sensors | ◐ (ESP32 hatchery) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Marketplace | ◐ (classifieds) | ❌ | ❌ | ❌ | ✅ (core) | ❌ |
| Live market price index | ❌ | ❌ | ❌ | ❌ | ✅ (goal) | ❌ |
| Vet access | ◐ (guide) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Moroccan regulation (ONSSA) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Arabic / Darija | ✅ Arabic | ❌ FR | ❌ FR | ❌ FR | ? | ? |

## 5. Gaps = opportunities for a new Moroccan project

1. **Price transparency for live broilers.** This is the #1 pain point: farmers sell below cost, and the only "data" is the FISA SMS. A crowdsourced and verified **daily price index by region**, plus farm-gate matching with buyers, is the clearest gap. Market Dawajin is aiming at it but has no product live yet.
2. **Built for real farm sizes and integrators.** Support multi-farm and multi-house, **technician and worker roles**, and contract farming between integrators or feed mills and their farmers. Poultry.ma's 1,000-bird cap leaves professional broiler farms without a tool.
3. **Offline-first mobile in Arabic / French** (Darija voice entry is a possible later step). Weak internet is the main barrier (IAV Hassan II). Jawdi proves that dictation and offline sync are a winning UX.
4. **Technical depth:** weighings and growth curves compared with Ross/Cobb standards, EPEF, mortality alerts, withdrawal periods (needed for ONSSA residue control).
5. **Plugging into existing hardware** (Rotem/Munters controllers, scales, water meters) rather than DIY sensors.
6. **The downstream segment:** a Dawajin Pro-like tool for live-poultry traders (rounds, weighing gaps, credit limits). There is **zero** offer in Morocco.
7. **B2B2C distribution channel:** sell through feed mills, hatcheries and FISA regional delegates, who already reach the farmers. Jawdi copies this model with cooperatives and feed suppliers.

## 6. Next steps for the benchmark

- [ ] Create a free Poultry.ma account and test the UX, the real limits and the Souk activity.
- [ ] Contact Market Dawajin (explorer@um6pventures.com) and Better Apps to qualify them.
- [ ] Search Google Play directly for Arabic and Darija keywords (دواجن، فراخ، بيلا).
- [ ] Interview 5 to 10 farmers (broiler, layer, traditional) and 2 traders to rank gaps 1 to 7.
- [ ] Ask equipment distributors which controllers are installed most and whether they have APIs.

## Sources

- Poultry.ma: https://poultry.ma/ · https://poultry.ma/fonctionnalites.php
- Market Dawajin: https://explorershowcase.um6pventures.com/mobile
- Better Apps: https://www.kerix.net/fr/annuaire-entreprise/better-apps
- TikVet: https://tikvet.ma/projet-elevage-de-poules-au-maroc/
- Aviculture au Maroc: https://www.avicultureaumaroc.com/
- Dawajin Pro: https://dawajinpro.tn/
- Jawdi: https://jawdi.app/
- Kolonell: https://kolonell.com/fr/blog/logiciel-aviculture-poulailler-suivi-2026
- Dwagen: https://ai.google.dev/competition/projects/dwagen
- IAV Hassan II study on technology adoption: https://agrimaroc.org/index.php/Actes_IAVH2/article/download/1106/1564
- Price crisis: https://medias24.com/2026/07/23/aviculture-prix-toujours-bas-jusqua-3-dh-de-pertes-par-kg-pour-les-eleveurs-1729173/ · https://www.infomediaire.net/filiere-avicole-au-maroc-forte-pression-sur-les-prix-du-poulet-vif/ · https://fr.le360.ma/economie/laviculture-en-crise-une-production-abondante-mais-des-prix-en-baisse-et-des-chaines-de-distribution_2QEBUYBHZFH2ZKS6XG7MDDSTG4/
- FISA: https://fr.hespress.com/434116-434116.html
- Launchpad Agritech: https://cio-mag.com/13-startups-retenues-pour-la-2eme-edition-du-programme-launchpad-agritech-dimpact-lab/
- Global roundups: https://gitnux.org/best/poultry-farm-management-software/ · https://agtech.folio3.com/poultry-management-software/broiler · https://apps.odoo.com/apps/modules/18.0/dev_advance_poultry_management
