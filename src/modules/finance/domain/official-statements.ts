import type { TrialBalanceRow } from "@/modules/finance/domain/books";

/*
 * SPEC-finance FC8 (T116, FQ22 decided defaults): the official statements in the CGNC's simplified model, and its PCA
 * variant when the entity has the PCA overlay. Sources (docs/sources/README.md):
 * - CGNC Tome I, scan pages: bilan p. 51, CPC p. 52, ETIC list p. 54, S1 p. 55 (the simplified model annexed to loi
 *   9-88); masses, rubriques and postes coded by 1, 2 and 3 digits of classes 1–5 (p. 156); simplified particularities
 *   pp. 171–173 (no "écarts de conversion" rubrique unless the entity has some); simplified plan de comptes pp. 316–339.
 * - PCA 2015 (docs/sources/plan-comptable-agricole-2015.pdf), Annexe B "modèle simplifié", PDF pages: bilan p. 181,
 *   CPC p. 182, S1 p. 184, S1-1 p. 185, S1 bis p. 186, S1 ter p. 187.
 * Each line lists the normal-model accounts (the seeded chart) by number prefix; an account goes to the line with its
 * longest matching prefix. A simplified poste takes the normal postes of the same number, and the rubrique's "divers"
 * poste takes the others (pp. 171–172, and the simplified plan's 117, 227, 237, 317, 347, 447).
 * Arabic: no official Arabic version in the sources (FQ12); faithful translations, to review.
 */

export type Label = { fr: string; ar: string };
type Poste = Label & { key: string; accounts: string[]; contra?: string[]; pca?: true; creditTo?: string };
type Rubrique = Label & { key: string; postes: Poste[]; accounts?: string[]; contra?: string[]; optional?: true };
type Masse = Label & { key: string; rubriques: Rubrique[] };

const p = (key: string, fr: string, ar: string, accounts: string[], more: Partial<Poste> = {}): Poste => ({ key, fr, ar, accounts, ...more });

// CGNC p. 51; PCA p. 181 adds "Plantations" and "Animaux immobilisés".
export const BILAN_ACTIF: Masse[] = [
  {
    key: "actifImmobilise", fr: "Actif immobilisé", ar: "الأصول الثابتة",
    rubriques: [
      { key: "nonValeurs", fr: "Immobilisation en non-valeurs (A)", ar: "التثبيتات عديمة القيمة (أ)", postes: [], accounts: ["21"], contra: ["281"] },
      {
        key: "incorporelles", fr: "Immobilisations incorporelles (B)", ar: "التثبيتات غير المادية (ب)", contra: ["292"],
        postes: [
          p("fondsCommercial", "Fonds commercial", "الأصل التجاري", ["223"], { contra: ["2823"] }),
          p("incorporellesDiverses", "Immobilisations incorporelles diverses", "تثبيتات غير مادية متنوعة", ["22"], { contra: ["282"] }),
        ],
      },
      {
        key: "corporelles", fr: "Immobilisations corporelles (C)", ar: "التثبيتات المادية (ج)", contra: ["293"],
        postes: [
          p("terrains", "Terrains", "الأراضي", ["231"], { contra: ["2831"] }),
          p("constructions", "Constructions", "البنايات", ["232"], { contra: ["2832"] }),
          p("installations", "Installations techniques, matériel et outillage", "المنشآت التقنية والمعدات والأدوات", ["233"], { contra: ["2833"] }),
          p("transport", "Matériel de transport", "معدات النقل", ["234"], { contra: ["2834"] }),
          p("plantations", "Plantations", "الأغراس", ["236"], { contra: ["2836", "2936"], pca: true }),
          p("animaux", "Animaux immobilisés", "الحيوانات المثبتة", ["237"], { contra: ["2837", "2937"], pca: true }),
          p("corporellesDiverses", "Immobilisations corporelles diverses", "تثبيتات مادية متنوعة", ["23"], { contra: ["283"] }),
        ],
      },
      { key: "financieres", fr: "Immobilisations financières (D)", ar: "التثبيتات المالية (د)", postes: [], accounts: ["24", "25"], contra: ["29"] },
      { key: "ecartsActifImmobilise", fr: "Écarts de conversion – actif", ar: "فروق التحويل – أصول", postes: [], accounts: ["27"], optional: true },
    ],
  },
  {
    key: "actifCirculant", fr: "Actif circulant (hors trésorerie)", ar: "الأصول المتداولة (خارج الخزينة)",
    rubriques: [
      {
        key: "stocks", fr: "Stocks (E)", ar: "المخزونات (هـ)",
        postes: [
          p("marchandises", "Marchandises", "البضائع", ["311"], { contra: ["3911"] }),
          p("stocksDivers", "Stocks divers", "مخزونات متنوعة", ["31"], { contra: ["391"] }),
        ],
      },
      {
        key: "creances", fr: "Créances de l’actif circulant (F)", ar: "ديون الأصول المتداولة (و)",
        postes: [
          p("clients", "Clients et comptes rattachés", "الزبناء والحسابات الملحقة", ["342"], { contra: ["3942"] }),
          p("associesActif", "Comptes d’associés", "حسابات الشركاء", ["346"], { contra: ["3946"] }),
          p("debiteursDivers", "Débiteurs divers", "مدينون متنوعون", ["34"], { contra: ["394"] }),
          p("regularisationActif", "Comptes de régularisation actif", "حسابات التسوية – أصول", ["349"]),
        ],
      },
      { key: "placements", fr: "Titres et valeurs de placement (G)", ar: "سندات وقيم التوظيف (ز)", postes: [], accounts: ["35"], contra: ["395"] },
      { key: "ecartsActifCirculant", fr: "Écarts de conversion – actif (éléments circulants)", ar: "فروق التحويل – أصول (عناصر متداولة)", postes: [], accounts: ["37"], optional: true },
    ],
  },
  {
    key: "tresorerieActif", fr: "Trésorerie", ar: "الخزينة",
    rubriques: [
      {
        key: "tresorerieActif", fr: "Trésorerie – actif", ar: "الخزينة – أصول", contra: ["59"],
        postes: [
          p("cheques", "Chèques et valeurs à encaisser", "شيكات وقيم للتحصيل", ["511"]),
          p("banques", "Banques, T.G. et C.C.P.", "الأبناك والخزينة العامة والحسابات الجارية البريدية", ["514"], { creditTo: "banquesCrediteurs" }),
          p("caisses", "Caisses, régies d’avances et accréditifs", "الصناديق ووكالات التسبيقات والاعتمادات", ["516"]),
        ],
      },
    ],
  },
];

export const BILAN_PASSIF: Masse[] = [
  {
    key: "financementPermanent", fr: "Financement permanent", ar: "التمويل الدائم",
    rubriques: [
      {
        key: "capitauxPropres", fr: "Capitaux propres (A)", ar: "رؤوس الأموال الذاتية (أ)",
        postes: [
          p("capital", "Capital social ou personnel", "رأس المال الاجتماعي أو الشخصي", ["111"]),
          p("nonAppele", "Moins : actionnaires, capital souscrit non appelé", "ناقص: المساهمون، رأس المال المكتتب غير المطلوب", ["1119"]),
          p("primes", "Primes d’émission, de fusion et d’apport", "علاوات الإصدار والاندماج والمساهمة", ["112"]),
          p("reevaluation", "Écarts de réévaluation", "فروق إعادة التقييم", ["113"]),
          p("reserves", "Réserves diverses", "احتياطيات متنوعة", ["114", "115"]),
          // 119 holds the previous year's result until it is allocated (FN3's à-nouveaux): "en instance d'affectation".
          p("reportANouveau", "Reports à nouveau et résultats nets en instance d’affectation", "الأرصدة المرحلة والنتائج الصافية في انتظار التخصيص", ["116", "118", "119"]),
          p("resultatNet", "Résultat net de l’exercice", "النتيجة الصافية للسنة المالية", []),
        ],
      },
      { key: "assimiles", fr: "Capitaux propres assimilés (B)", ar: "رؤوس الأموال الذاتية المماثلة (ب)", postes: [], accounts: ["13"] },
      { key: "dettesFinancement", fr: "Dettes de financement (C)", ar: "ديون التمويل (ج)", postes: [], accounts: ["14"] },
      { key: "provisionsDurables", fr: "Provisions durables pour risques et charges (D)", ar: "مؤونات دائمة للمخاطر والتكاليف (د)", postes: [], accounts: ["15"] },
      { key: "liaison", fr: "Comptes de liaison des établissements et succursales", ar: "حسابات الربط بين المؤسسات والفروع", postes: [], accounts: ["16"], optional: true },
      { key: "ecartsPassifPermanent", fr: "Écarts de conversion – passif", ar: "فروق التحويل – خصوم", postes: [], accounts: ["17"], optional: true },
    ],
  },
  {
    key: "passifCirculant", fr: "Passif circulant (hors trésorerie)", ar: "الخصوم المتداولة (خارج الخزينة)",
    rubriques: [
      {
        key: "dettesCirculant", fr: "Dettes du passif circulant (E)", ar: "ديون الخصوم المتداولة (هـ)",
        postes: [
          p("fournisseurs", "Fournisseurs et comptes rattachés", "الموردون والحسابات الملحقة", ["441"]),
          p("associesPassif", "Comptes d’associés", "حسابات الشركاء", ["446"]),
          p("crediteursDivers", "Créanciers divers", "دائنون متنوعون", ["44"]),
          p("regularisationPassif", "Comptes de régularisation passif", "حسابات التسوية – خصوم", ["449"]),
        ],
      },
      { key: "autresProvisions", fr: "Autres provisions pour risques et charges (F)", ar: "مؤونات أخرى للمخاطر والتكاليف (و)", postes: [], accounts: ["45"] },
      { key: "ecartsPassifCirculant", fr: "Écarts de conversion – passif (éléments circulants)", ar: "فروق التحويل – خصوم (عناصر متداولة)", postes: [], accounts: ["47"], optional: true },
    ],
  },
  {
    key: "tresoreriePassif", fr: "Trésorerie", ar: "الخزينة",
    rubriques: [
      {
        key: "tresoreriePassif", fr: "Trésorerie – passif", ar: "الخزينة – خصوم",
        postes: [
          p("escompte", "Crédits d’escompte et de trésorerie", "اعتمادات الخصم والخزينة", ["552", "553"]),
          p("banquesCrediteurs", "Banques (soldes créditeurs)", "الأبناك (أرصدة دائنة)", ["554"]),
        ],
      },
    ],
  },
];

// CPC. A line's accounts are class 6 or 7; a product is a credit (−balance), a charge a debit.
type CpcLine = Label & { key: string; accounts: string[]; pca?: true };
type CpcGroup = Label & { key: string; product: boolean; lines: CpcLine[] };
type CpcResult = Label & { key: string; of: (v: Record<string, bigint>) => bigint };
export type CpcModel = { key: "cgnc" | "pca"; groups: CpcGroup[]; results: CpcResult[] };

const l = (key: string, fr: string, ar: string, accounts: string[]): CpcLine => ({ key, fr, ar, accounts });
const r = (key: string, fr: string, ar: string, of: CpcResult["of"]): CpcResult => ({ key, fr, ar, of });

const sales = [l("ventesMarchandises", "Ventes de marchandises (en l’état)", "مبيعات البضائع (على حالها)", ["711"]), l("ventesBiens", "Ventes de biens et services produits", "مبيعات السلع والخدمات المنتجة", ["712"])];
const operatingCharges = [
  l("achatsRevendus", "Achats revendus de marchandises", "مشتريات البضائع المعاد بيعها", ["611"]),
  l("achatsConsommes", "Achats consommés de matières et fournitures", "مشتريات المواد واللوازم المستهلكة", ["612"]),
  l("chargesExternes", "Autres charges externes", "تكاليف خارجية أخرى", ["613", "614"]),
  l("impots", "Impôts et taxes", "الضرائب والرسوم", ["616"]),
  l("personnel", "Charges de personnel", "تكاليف المستخدمين", ["617"]),
  l("autresChargesExploitation", "Autres charges d’exploitation", "تكاليف أخرى للاستغلال", ["618"]),
  l("dotationsExploitation", "Dotations d’exploitation", "مخصصات الاستغلال", ["619"]),
];
const ca = r("chiffreAffaires", "Chiffre d’affaires", "رقم المعاملات", (v) => v.ventesMarchandises + v.ventesBiens);
const tail = [
  r("marge", "Marge brute sur ventes en l’état", "الهامش الإجمالي على المبيعات على حالها", (v) => v.ventesMarchandises - v.achatsRevendus),
];

// CGNC simplified CPC, scan p. 52. Line 5 prints "Subventions d'exploitation" and "Autres produits d'exploitation"
// together; the simplified plan has no 716 (pp. 316–339), so 716 goes to that line's first half.
export const CPC_CGNC: CpcModel = {
  key: "cgnc",
  groups: [
    {
      key: "I", fr: "Produits courants", ar: "المنتجات الجارية", product: true,
      lines: [
        ...sales,
        l("variationStocks", "Variation de stocks de produits", "تغير مخزون المنتجات", ["713"]),
        l("immobilisationsProduites", "Immobilisations produites par l’entreprise pour elle-même", "التثبيتات المنتجة من طرف المقاولة لنفسها", ["714"]),
        l("subventions", "Subventions d’exploitation", "إعانات الاستغلال", ["716"]),
        l("autresProduits", "Autres produits d’exploitation", "منتجات أخرى للاستغلال", ["718"]),
        l("reprisesExploitation", "Reprises d’exploitation, transferts de charges", "استردادات الاستغلال وتحويلات التكاليف", ["719"]),
        l("produitsFinanciers", "Produits financiers", "المنتجات المالية", ["73"]),
      ],
    },
    { key: "II", fr: "Charges courantes", ar: "التكاليف الجارية", product: false, lines: [...operatingCharges, l("chargesFinancieres", "Charges financières", "التكاليف المالية", ["63"])] },
    { key: "IVp", fr: "Produits non courants", ar: "المنتجات غير الجارية", product: true, lines: [l("produitsNonCourants", "Produits non courants", "المنتجات غير الجارية", ["75"])] },
    { key: "IVc", fr: "Charges non courantes", ar: "التكاليف غير الجارية", product: false, lines: [l("chargesNonCourantes", "Charges non courantes", "التكاليف غير الجارية", ["65"])] },
    { key: "VII", fr: "Impôts sur les résultats", ar: "الضرائب على النتائج", product: false, lines: [l("impotsResultats", "Impôts sur les résultats", "الضرائب على النتائج", ["67"])] },
  ],
  results: [
    ca,
    r("III", "Résultat courant (I − II)", "النتيجة الجارية (I − II)", (v) => v.I - v.II),
    r("V", "Résultat non courant", "النتيجة غير الجارية", (v) => v.IVp - v.IVc),
    r("VI", "Résultat avant impôts (III + V)", "النتيجة قبل الضرائب (III + V)", (v) => v.I - v.II + v.IVp - v.IVc),
    r("VIII", "Résultat net", "النتيجة الصافية", (v) => v.I - v.II + v.IVp - v.IVc - v.VII),
    r("IX", "Total des produits", "مجموع المنتجات", (v) => v.I + v.IVp),
    r("X", "Total des charges", "مجموع التكاليف", (v) => v.II + v.IVc + v.VII),
    ...tail,
    r("valeurAjoutee", "Valeur ajoutée (1 + 2 + 3 + 4) − (8 + 9 + 10)", "القيمة المضافة (1 + 2 + 3 + 4) − (8 + 9 + 10)", (v) => v.ventesMarchandises + v.ventesBiens + v.variationStocks + v.immobilisationsProduites - v.achatsRevendus - v.achatsConsommes - v.chargesExternes),
  ],
};

// PCA simplified CPC, Annexe B PDF p. 182: the normal model's cascade, with "Variation d'inventaire (animaux immobilisés)".
export const CPC_PCA: CpcModel = {
  key: "pca",
  groups: [
    {
      key: "I", fr: "Produits d’exploitation", ar: "منتجات الاستغلال", product: true,
      lines: [
        ...sales,
        l("variationStocks", "Variation de stocks de produits", "تغير مخزون المنتجات", ["713"]),
        l("variationInventaire", "Variation d’inventaire (animaux immobilisés)", "تغير الجرد (الحيوانات المثبتة)", ["715"]),
        l("immobilisationsProduites", "Immobilisations produites par l’entreprise pour elle-même", "التثبيتات المنتجة من طرف المقاولة لنفسها", ["714"]),
        l("subventions", "Subventions d’exploitation", "إعانات الاستغلال", ["716"]),
        l("autresProduits", "Autres produits d’exploitation", "منتجات أخرى للاستغلال", ["718"]),
        l("reprisesExploitation", "Reprises d’exploitation, transferts de charges", "استردادات الاستغلال وتحويلات التكاليف", ["719"]),
      ],
    },
    { key: "II", fr: "Charges d’exploitation", ar: "تكاليف الاستغلال", product: false, lines: operatingCharges },
    {
      key: "IV", fr: "Produits financiers", ar: "المنتجات المالية", product: true,
      lines: [
        l("produitsTitres", "Produits des titres de participation et autres titres immobilisés", "منتجات سندات المساهمة والسندات المثبتة الأخرى", ["732"]),
        l("gainsChange", "Gains de change", "أرباح الصرف", ["733"]),
        l("interetsProduits", "Intérêts et autres produits financiers", "الفوائد والمنتجات المالية الأخرى", ["73"]),
        l("reprisesFinancieres", "Reprises financières, transferts de charges", "الاستردادات المالية وتحويلات التكاليف", ["739"]),
      ],
    },
    {
      key: "V", fr: "Charges financières", ar: "التكاليف المالية", product: false,
      lines: [
        l("interetsCharges", "Charges d’intérêts", "تكاليف الفوائد", ["631"]),
        l("pertesChange", "Pertes de change", "خسائر الصرف", ["633"]),
        l("autresChargesFinancieres", "Autres charges financières", "تكاليف مالية أخرى", ["63"]),
        l("dotationsFinancieres", "Dotations financières", "المخصصات المالية", ["639"]),
      ],
    },
    {
      key: "VIII", fr: "Produits non courants", ar: "المنتجات غير الجارية", product: true,
      lines: [
        l("cessions", "Produits des cessions d’immobilisations", "منتجات تفويت التثبيتات", ["751"]),
        l("subventionsEquilibre", "Subventions d’équilibre", "إعانات التوازن", ["756"]),
        l("reprisesSubventions", "Reprises sur subventions d’investissement", "استردادات على إعانات الاستثمار", ["757"]),
        l("autresProduitsNonCourants", "Autres produits non courants", "منتجات أخرى غير جارية", ["75"]),
        l("reprisesNonCourantes", "Reprises non courantes, transferts de charges", "الاستردادات غير الجارية وتحويلات التكاليف", ["759"]),
      ],
    },
    {
      key: "IX", fr: "Charges non courantes", ar: "التكاليف غير الجارية", product: false,
      lines: [
        l("vna", "Valeurs nettes d’amortissements des immobilisations cédées", "القيم الصافية من الاستهلاكات للتثبيتات المفوتة", ["651"]),
        l("subventionsAccordees", "Subventions accordées", "الإعانات الممنوحة", ["656"]),
        l("autresChargesNonCourantes", "Autres charges non courantes", "تكاليف أخرى غير جارية", ["65"]),
        l("dotationsNonCourantes", "Dotations non courantes aux amortissements et aux provisions", "المخصصات غير الجارية للاستهلاكات والمؤونات", ["659"]),
      ],
    },
    { key: "XII", fr: "Impôts sur les bénéfices", ar: "الضرائب على الأرباح", product: false, lines: [l("impotsResultats", "Impôts sur les bénéfices", "الضرائب على الأرباح", ["67"])] },
  ],
  results: [
    ca,
    r("III", "Résultat d’exploitation (I − II)", "نتيجة الاستغلال (I − II)", (v) => v.I - v.II),
    r("VI", "Résultat financier (IV − V)", "النتيجة المالية (IV − V)", (v) => v.IV - v.V),
    r("VII", "Résultat courant (III + VI)", "النتيجة الجارية (III + VI)", (v) => v.I - v.II + v.IV - v.V),
    r("X", "Résultat non courant (VIII − IX)", "النتيجة غير الجارية (VIII − IX)", (v) => v.VIII - v.IX),
    r("XI", "Résultat avant impôts (VII + X)", "النتيجة قبل الضرائب (VII + X)", (v) => v.I - v.II + v.IV - v.V + v.VIII - v.IX),
    r("XIII", "Résultat net (XI − XII)", "النتيجة الصافية (XI − XII)", (v) => v.I - v.II + v.IV - v.V + v.VIII - v.IX - v.XII),
    r("XIV", "Total des produits (I + IV + VIII)", "مجموع المنتجات (I + IV + VIII)", (v) => v.I + v.IV + v.VIII),
    r("XV", "Total des charges (II + V + IX + XII)", "مجموع التكاليف (II + V + IX + XII)", (v) => v.II + v.V + v.IX + v.XII),
    ...tail,
  ],
};

// ETIC tables computable from the ledger: S1 and S1 bis (CGNC p. 55, PCA pp. 184, 186) by the bilan's postes;
// S1-1 and S1 ter (PCA pp. 185, 187) with the PCA overlay only.
type EticRow = Label & { key: string; accounts: string[]; pca?: true };
const fixedPostes = BILAN_ACTIF[0].rubriques.flatMap((rb) => (rb.key === "financieres" || rb.optional ? [] : rb.postes.length ? rb.postes : [p(rb.key, rb.fr, rb.ar, rb.accounts ?? [], { contra: rb.contra })]));
export const ETIC_S1: EticRow[] = fixedPostes.map((x) => ({ key: x.key, fr: x.fr, ar: x.ar, accounts: x.accounts, pca: x.pca }));
// Amortissements only (class 28); the provisions (29) belong to S3.
export const ETIC_S1BIS: EticRow[] = fixedPostes.map((x) => ({ key: x.key, fr: x.fr, ar: x.ar, accounts: (x.contra ?? []).filter((a) => a.startsWith("28")), pca: x.pca }));
export const ETIC_S1_1: EticRow[] = [
  { key: "animauxImmobilisations", fr: "Animaux – immobilisations", ar: "الحيوانات – تثبيتات", accounts: ["237"] },
  { key: "animauxEnCours", fr: "Animaux – immobilisations biologiques en cours", ar: "الحيوانات – تثبيتات بيولوجية جارية", accounts: ["23962"] },
  { key: "plantationsImmobilisations", fr: "Plantations – immobilisations", ar: "الأغراس – تثبيتات", accounts: ["236"] },
  { key: "plantationsEnCours", fr: "Plantations – immobilisations biologiques en cours", ar: "الأغراس – تثبيتات بيولوجية جارية", accounts: ["23961"] },
];
// No stock account of the PCA names "plantations matures": the row stays empty (to review, FQ22).
export const ETIC_S1TER: EticRow[] = [
  { key: "plantationsMatures", fr: "Plantations matures", ar: "الأغراس الناضجة", accounts: [] },
  { key: "animauxAdultes", fr: "Animaux adultes", ar: "الحيوانات البالغة", accounts: ["316", "3171"] },
  { key: "plantationsEnCours", fr: "Plantations en cours (immatures)", ar: "الأغراس الجارية (غير الناضجة)", accounts: ["3131", "31321"] },
  { key: "animauxEnCours", fr: "Animaux en cours (immatures)", ar: "الحيوانات الجارية (غير الناضجة)", accounts: ["31322"] },
];

/** The CNC's revenue limits for the simplified model: CNC avis n° 1 (CGNC scan p. 68): ≤ 7,5 M DH; PCA 2015 (PDF pp. 17–19): 10 M DH. */
export const SIMPLIFIED_LIMIT_CENTIMES = 1_000_000_000n; // 10 000 000,00 DH, the PCA's (FQ22 decided default)

/** An account's line: the target whose prefix is the longest one matching, or null. */
export function lineOf<T>(account: string, targets: readonly (readonly [string, T])[]): T | null {
  let best: { prefix: string; target: T } | null = null;
  for (const [prefix, target] of targets) if (account.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) best = { prefix, target };
  return best?.target ?? null;
}

type Target = { poste: string; contra: boolean };
/** The bilan's prefixes → poste (gross or contra), the PCA postes only with the overlay. Rubrique-level accounts use the rubrique key. */
export function bilanTargets(pca: boolean): [string, Target][] {
  const out: [string, Target][] = [];
  for (const m of [...BILAN_ACTIF, ...BILAN_PASSIF])
    for (const rb of m.rubriques) {
      for (const a of rb.accounts ?? []) out.push([a, { poste: rb.key, contra: false }]);
      for (const a of rb.contra ?? []) out.push([a, { poste: rb.key, contra: true }]);
      for (const x of rb.postes) {
        if (x.pca && !pca) continue;
        for (const a of x.accounts) out.push([a, { poste: x.key, contra: false }]);
        for (const a of x.contra ?? []) out.push([a, { poste: x.key, contra: true }]);
      }
    }
  return out;
}

export const cpcModel = (pca: boolean) => (pca ? CPC_PCA : CPC_CGNC);
export const cpcTargets = (model: CpcModel): [string, string][] => model.groups.flatMap((g) => g.lines.flatMap((x) => x.accounts.map((a): [string, string] => [a, x.key])));

export type Amounts = { gross: bigint; contra: bigint; net: bigint };
export type BilanLine = Label & Amounts & { key: string };
export type BilanRubrique = BilanLine & { optional: boolean; postes: BilanLine[] };
export type BilanMasse = Label & { key: string; net: bigint; rubriques: BilanRubrique[] };

/** FC8: the CPC of the model for these trial-balance rows: each line, each group's total, the results. */
export function officialCpc(rows: readonly TrialBalanceRow[], pca: boolean) {
  const model = cpcModel(pca);
  const targets = cpcTargets(model);
  const v: Record<string, bigint> = {};
  for (const g of model.groups) for (const x of g.lines) v[x.key] = 0n;
  const unmapped: string[] = [];
  for (const row of rows) {
    if (!/^[67]/.test(row.account)) continue;
    const key = lineOf(row.account, targets);
    if (key === null) unmapped.push(row.account);
    else v[key] += row.balance;
  }
  const groups = model.groups.map((g) => {
    const lines = g.lines.map((x) => ({ key: x.key, fr: x.fr, ar: x.ar, amount: g.product ? -v[x.key] : v[x.key] }));
    for (const x of lines) v[x.key] = x.amount;
    const total = lines.reduce((s, x) => s + x.amount, 0n);
    v[g.key] = total;
    return { key: g.key, fr: g.fr, ar: g.ar, product: g.product, total, lines };
  });
  const results = model.results.map((x) => ({ key: x.key, fr: x.fr, ar: x.ar, amount: x.of(v) }));
  const net = groups.reduce((s, g) => s + (g.product ? g.total : -g.total), 0n);
  return { model: model.key, groups, results, net, unmapped };
}

/** FC8: the bilan of the model: gross, amortissements et provisions, net per poste; the result line is the CPC's net. */
export function officialBilan(rows: readonly TrialBalanceRow[], pca: boolean) {
  const targets = bilanTargets(pca);
  const amounts = new Map<string, { gross: bigint; contra: bigint }>();
  const add = (key: string, gross: bigint, contra: bigint) => {
    const a = amounts.get(key) ?? { gross: 0n, contra: 0n };
    amounts.set(key, { gross: a.gross + gross, contra: a.contra + contra });
  };
  const postes = new Map([...BILAN_ACTIF, ...BILAN_PASSIF].flatMap((m) => m.rubriques.flatMap((rb) => rb.postes.map((x) => [x.key, x] as const))));
  const actif = new Set(BILAN_ACTIF.flatMap((m) => m.rubriques.flatMap((rb) => [rb.key, ...rb.postes.map((x) => x.key)])));
  const unmapped: string[] = [];
  for (const row of rows) {
    if (!/^[1-5]/.test(row.account) || row.balance === 0n) continue;
    const t = lineOf(row.account, targets);
    if (!t) {
      unmapped.push(row.account);
      continue;
    }
    const creditTo = postes.get(t.poste)?.creditTo;
    // An actif line holds debits (gross) and contra credits; a passif line credits. A bank in credit is a passif (554).
    if (creditTo && row.balance < 0n) add(creditTo, -row.balance, 0n);
    else if (!actif.has(t.poste)) add(t.poste, -row.balance, 0n);
    else if (t.contra) add(t.poste, 0n, -row.balance);
    else add(t.poste, row.balance, 0n);
  }
  const cpc = officialCpc(rows, pca);
  add("resultatNet", cpc.net, 0n);
  const line = (x: Label & { key: string }): BilanLine => {
    const a = amounts.get(x.key) ?? { gross: 0n, contra: 0n };
    return { key: x.key, fr: x.fr, ar: x.ar, gross: a.gross, contra: a.contra, net: a.gross - a.contra };
  };
  const masses = (ms: Masse[]): BilanMasse[] =>
    ms.map((m) => {
      const rubriques = m.rubriques.map((rb) => {
        const own = line(rb);
        const ps = rb.postes.filter((x) => pca || !x.pca).map(line);
        const gross = ps.reduce((s, x) => s + x.gross, own.gross);
        const contra = ps.reduce((s, x) => s + x.contra, own.contra);
        return { ...own, gross, contra, net: gross - contra, optional: rb.optional === true, postes: ps };
      });
      return { key: m.key, fr: m.fr, ar: m.ar, net: rubriques.reduce((s, x) => s + x.net, 0n), rubriques };
    });
  const a = masses(BILAN_ACTIF);
  const pa = masses(BILAN_PASSIF);
  return { actif: a, passif: pa, totalActif: a.reduce((s, m) => s + m.net, 0n), totalPassif: pa.reduce((s, m) => s + m.net, 0n), result: cpc.net, unmapped };
}

export type EticMovement = Label & { key: string; start: bigint; increase: bigint; decrease: bigint; end: bigint };

/**
 * FC8: an ETIC table's rows from the à-nouveaux (`opening`) and the year's other lines (`movements`), on each row's
 * accounts by prefix: start, debits, credits, end, signed as the side the row is on (`credit` for amortissements).
 */
export function eticTable(rowsDef: readonly EticRow[], opening: readonly TrialBalanceRow[], movements: readonly TrialBalanceRow[], pca: boolean, credit = false): EticMovement[] {
  const defs = rowsDef.filter((x) => pca || !x.pca);
  const targets = defs.flatMap((x) => x.accounts.map((a): [string, string] => [a, x.key]));
  const sum = (rows: readonly TrialBalanceRow[], key: string, f: (r: TrialBalanceRow) => bigint) => rows.reduce((s, r) => s + (lineOf(r.account, targets) === key ? f(r) : 0n), 0n);
  return defs.map((x) => {
    const start = sum(opening, x.key, (r) => (credit ? -r.balance : r.balance));
    const increase = sum(movements, x.key, (r) => (credit ? r.credit : r.debit));
    const decrease = sum(movements, x.key, (r) => (credit ? r.debit : r.credit));
    return { key: x.key, fr: x.fr, ar: x.ar, start, increase, decrease, end: start + increase - decrease };
  });
}

/** FC8: the ETIC tables the ledger can fill (S1, S1 bis; S1-1 and S1 ter with the PCA overlay). */
export function eticTables(opening: readonly TrialBalanceRow[], movements: readonly TrialBalanceRow[], pca: boolean) {
  return {
    s1: eticTable(ETIC_S1, opening, movements, pca),
    s1bis: eticTable(ETIC_S1BIS, opening, movements, pca, true),
    ...(pca && { s1_1: eticTable(ETIC_S1_1, opening, movements, pca), s1ter: eticTable(ETIC_S1TER, opening, movements, pca) }),
  };
}
