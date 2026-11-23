# Official ONSSA texts (French)

Text extracted from the official PDFs published by ONSSA, converted to UTF-8, nothing else changed. These are the
texts the register (SPEC-m2-compliance RP1–RP2) and the inspection checklist (RP4) cite; see SPEC-m2-compliance §9.
Accessed 2026-11-23.

| Id | File | Text | BO | URL |
|---|---|---|---|---|
| S1 | `ARR.2126-05.FR.a.txt` | Arrêté n° 2126-05 du 13 kaada 1426 (15 décembre 2005) fixant la forme et le contenu du registre de suivi sanitaire des élevages avicoles et des couvoirs | BO n° 5392 du 2 février 2006, p. 237 | https://www.onssa.gov.ma/wp-content/uploads/2022/06/Reglementation/B.Reglementation-Sectorielle/1.%20Sant%C3%A9%20Animale/1.5.%20Aviculture/ARR.2126-05.FR.pdf |
| S2 | `ARR.2127-05.FR.a.txt` | Arrêté n° 2127-05 du 13 kaada 1426 (15 décembre 2005) fixant les exigences sanitaires et hygiéniques communes et spécifiques auxquelles doivent répondre les locaux, les équipements et le fonctionnement des élevages avicoles et/ou des couvoirs | BO n° 5392 du 2 février 2006, p. 239 | https://www.onssa.gov.ma/wp-content/uploads/2022/06/Reglementation/B.Reglementation-Sectorielle/1.%20Sant%C3%A9%20Animale/1.5.%20Aviculture/ARR.2127-05.FR.pdf |
| S3 | `LOI.49-99.FR.txt` | Loi n° 49-99 relative à la protection sanitaire des élevages avicoles, au contrôle de la production et la commercialisation des produits avicoles, promulguée par le dahir n° 1-02-119 du 1 rabii II 1423 (13 juin 2002) | BO n° 5036 du 5 septembre 2002, p. 901 | https://www.onssa.gov.ma/wp-content/uploads/2021/11/LOI.49-99.FR.pdf |
| S4 | `DEC.consolide.txt` | Décret n° 2-04-684 du 14 kaada 1425 (27 décembre 2004) pris pour l'application de la loi n° 49-99, version consolidée du 5 octobre 2023, tel que modifié par le décret n° 2-23-111 du 2 rabii I 1445 (18 septembre 2023) | BO n° 5280 du 6 janvier 2005, p. 7; amendment BO n° 7236 du 5 octobre 2023, p. 2204 | ONSSA site, Réglementation (consolidated version; exact URL to record) |
| S5 | `ARR.2124-05.FR.a.txt` | Arrêté n° 2124-05 du 13 kaada 1426 (15 décembre 2005) fixant les pièces composant la demande d'autorisation pour l'exercice des activités d'élevage avicole (…) | BO n° 5392 du 2 février 2006, p. 235 | https://www.onssa.gov.ma/wp-content/uploads/2022/06/Reglementation/B.Reglementation-Sectorielle/1.%20Sant%C3%A9%20Animale/1.5.%20Aviculture/ARR.2124-05.FR.pdf |
| S6 | `ARR.3308-17.FR.txt` | Arrêté n° 3308-17 du 21 rabii I 1439 (10 décembre 2017) relatif aux mesures complémentaires et spéciales pour lutter contre la maladie de Newcastle | BO n° 6700 du 6 août 2018, p. 1557 | https://www.onssa.gov.ma/wp-content/uploads/2021/11/ARR.3308-17.FR.pdf |
| S7 | `ARR.2466-17.FR.txt` | Arrêté n° 2466-17 du 5 moharrem 1439 (26 septembre 2017) relatif aux mesures complémentaires et spéciales pour lutter contre l'influenza aviaire hautement pathogène (peste aviaire) | BO n° 6644 du 1 février 2018, p. 403 | ONSSA site, Réglementation (exact URL to record) |

## What is cited where

- S1 art. 2–9, 16: the register's sections, cover, daily data, vet visas, paper and pagination, retention (`src/modules/reporting/domain/register.ts`, `src/components/register-document.tsx`, `INSPECTION_LOOKBACK_MONTHS`).
- S2 art. 2, 4; S3 art. 1, 2, 7, 12, 15; S4 art. 8; S5 art. 1; S6 art. 13–14: the inspection checklist lines (`src/modules/reporting/domain/inspection.ts`, `CHECK_SOURCES`).
- S6 art. 14 and S7 art. 13: the vaccination columns of the register (vaccine, commercial name, lot, date, number, species, age).
