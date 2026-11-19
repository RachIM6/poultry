# Ubiquitous language (code ⇄ French ⇄ Arabic)

Use these names in code, in the database and in message keys. Add a term here before introducing it. Never add a synonym.

| Code term | Module | French (UI) | Arabic (UI) | Meaning |
|---|---|---|---|---|
| `Organization` | farm-registry | Organisation | المؤسسة | The customer account. Owns legal entities and farms |
| `LegalEntity` | farm-registry | Entité juridique | الكيان القانوني | Individual, indivision, company, cooperative, association, GIE. It sets the accounting profile |
| `Farm` | farm-registry | Ferme / exploitation | الضيعة | One site, with its ONSSA authorization |
| `House` | farm-registry | Bâtiment | المبنى / الحظيرة | One poultry house, with area and capacity |
| `Batch` | flock | Bande / lot | الدفعة | One placement of birds in a house, from placement to closing |
| `FarmDay` | kernel | Jour | اليوم | A calendar day in Africa/Casablanca |
| `DailyEntry` | flock | Saisie du jour | التسجيل اليومي | Mortality, culls, feed, water, note for one batch and one farm day |
| `Weighing` | flock | Pesée | الوزن | A sample of birds weighed on a given day |
| `DeathCause` | flock | Cause de mortalité | سبب النفوق | An item from a fixed list |
| `Thinning` | flock / sales | Desserrage | البيع الجزئي | A partial sale while the batch stays open |
| `Strain` | reference-data | Souche | السلالة | e.g. Ross 308, Cobb 500 |
| `StandardCurve` | reference-data | Courbe standard | المنحنى المعياري | Daily target weight and feed per strain, with source and version |
| `Protocol` | reference-data / health | Programme de vaccination | برنامج التلقيح | Template of vaccines with due day (age) |
| `VaccinationPlanItem` | health | Vaccin prévu | لقاح مبرمج | One vaccine due for a batch |
| `Treatment` | health | Traitement | العلاج | Medicine given to a batch, with start and end |
| `WithdrawalPeriod` | health | Délai d'attente | مدة الانتظار | Days after a treatment ends during which birds must not be sold for consumption |
| `VetVisit` | health | Visite vétérinaire | زيارة الطبيب البيطري | Log entry of a vet visit |
| `StockItem` | inventory | Article | مادة المخزون | Feed, vaccine, medicine, litter, gas… per farm |
| `Movement` | inventory | Mouvement de stock | حركة المخزون | Purchase, consumption or adjustment. Stock = sum of movements |
| `Lot` | inventory | Lot / numéro de lot | رقم الحصة | Manufacturer lot of a vaccine or medicine, with expiry |
| `Supplier` | inventory | Fournisseur | المورّد | Who sells inputs. Has a balance (credit) |
| `Buyer` | sales | Acheteur | المشتري | Trader, abattoir, live-bird market… |
| `Sale` | sales | Vente | البيع | Birds, weights, price per kg, payment |
| `WeighingGap` | sales | Écart de pesée | فرق الوزن | Farm weight − buyer weight |
| `PaymentInstrument` | sales | Moyen de paiement | وسيلة الأداء | Cash, cheque, bill of exchange (traite / كمبيالة), transfer, credit |
| `Receivable` | sales | Créance | دين على الزبون | Unpaid part of a sale |
| `OriginDocument` | sales | Document d'origine | وثيقة المصدر | Printed per sale for industrial abattoirs (law 49-99 art. 10) |
| `Membership` | identity | Membre | العضو | User × organisation × role (owner, manager, worker) |
| `Mutation` | sync | — | — | One offline write, applied idempotently |

KPI names: `mortalityPct`, `livabilityPct`, `feedPerBirdGrams`, `fcr`, `epef`, `adgGrams` (average daily gain), `costPerKgCentimes`.
