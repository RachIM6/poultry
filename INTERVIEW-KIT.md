# Interview kit / دليل المقابلات

_Draft v0.2, 26 Oct 2026. It tests the hypotheses in [NEEDS-ANALYSIS.md §7](NEEDS-ANALYSIS.md) and the open questions in [SCOPE.md §6](SCOPE.md)._

**Languages:** each question is in **French** and **simplified standard Arabic** (فصحى مبسطة), the platform's languages. During the interview, say the question in the language the farmer is comfortable with, including Darija. The written text is the reference meaning, not a script to read word for word.

---

## 0. What we are testing

| Code | Hypothesis / open question | Tested with |
|---|---|---|
| **H1** | Farms pay for **cost per kg + margin** more than for compliance | Farmer, Integrator |
| **H2** | Buying **feed on credit** from the supplier is the norm | Farmer, Coop, Integrator |
| **H3** | Vets would use a **shared digital register** if it saves them time | Vet, Farmer |
| **H4** | Cooperatives struggle with **cooperative accounting / general assembly paperwork** | Coop |
| **H5** | Farmers would **share their selling price** to get a regional price index | Farmer, Coop |
| **H6** | **Workers** enter the data, so a **simple mobile UI in Arabic** matters more than a web dashboard. Note any demand for voice / Darija | Farmer, Integrator |
| **H7** | Integrators would **pay per farm** and push the app to their farmers | Integrator |
| **Q1** | Share of farms that **mix their own feed** | Farmer, Coop, Integrator |
| **Q2** | How buyers pay (cash / cheque / bill of exchange) and **how late** | Farmer, Coop |
| **Q3** | **Who** enters the data, on **which phone** | Farmer, Integrator |
| **Q4** | Is **manure sold**, at what price | Farmer |
| **Q5** | How often the **vet visits**, who pays | Farmer, Vet |
| **Q6** | Which **documents ONSSA inspectors** really ask for | Vet, Farmer |
| **Q7** | What integrators **need to see** from their contracted farms | Integrator |

## 1. Method

**Sample (first round, ~25 interviews)**

| Segment | Target | Where |
|---|---|---|
| Broiler farmers (S2), 5k–40k birds | 8–10 | Casablanca-Settat, Rabat-Salé-Kénitra, Fès-Meknès |
| Layer farmers (S3) | 3–4 | Same + Marrakech-Safi |
| Turkey farmers (S4) | 2 | Any |
| Traditional / beldi (S1) | 2–3 | Rural, Souss / Oriental |
| Private vets (poultry) | 3–4 | Mixed regions |
| Cooperatives (poultry) | 2–3 | Via ODCO directory / regional agriculture offices |
| Integrators / feed mills / hatcheries | 2 | Via FISA / Dawajine trade fair |

**Rules of the interview (the "Mom Test")**
1. Ask about **what they did last time**, not what they would do ("the last batch…", "last month…").
2. **Don't pitch** the app before the end. Don't say "would you use…".
3. Ask for **numbers** (DH, days, %), and ask to **see** the notebook, register or delivery note. Take a photo only with permission.
4. 45 min maximum. Two people: one asks, one writes. Visit on the farm if possible, respecting biosecurity (overshoes, no visit if you came from another farm the same day).
5. Write notes **the same day** in the synthesis grid (§7).

**Consent (read at the start)**

| FR | العربية |
|---|---|
| Bonjour, nous sommes une petite équipe qui étudie le travail des éleveurs de volaille au Maroc. Nous ne vendons rien aujourd'hui. L'entretien dure environ 45 minutes. Vos réponses restent anonymes. Est-ce qu'on peut prendre des notes ? Est-ce qu'on peut enregistrer l'audio, juste pour nous ? | السلام عليكم، نحن فريق صغير ندرس عمل مربّي الدواجن في المغرب. لا نبيع أي شيء اليوم. تستغرق المقابلة حوالي 45 دقيقة، وتبقى إجاباتك دون ذكر اسمك. هل يمكننا تدوين ملاحظات؟ وهل يمكننا تسجيل الصوت لاستعمالنا الداخلي فقط؟ |

> Audio recordings and photos are personal data (law 09-08). Keep them on a private drive, delete them after transcription, and never note the full name next to sensitive answers (debts, income).

---

## 2. Guide A: Farmer (broiler / layer / turkey / beldi)

### A1. Profile (5 min)
| # | FR | العربية | Tests |
|---|---|---|---|
| A1.1 | Depuis combien de temps vous élevez ? Quelles espèces ? | منذ متى وأنت تربي الدواجن؟ وما الأنواع التي تربيها: دجاج اللحم، الدجاج البيّاض، الديك الرومي، الدجاج البلدي؟ | Profile |
| A1.2 | Combien de bâtiments, combien de sujets par bande, combien de bandes par an ? | كم عدد المباني (الحظائر) لديك؟ وكم عدد الكتاكيت في كل دفعة؟ وكم دفعة في السنة؟ | Profile |
| A1.3 | La ferme est à vous seul, en famille, en société ou en coopérative ? | هل الضيعة ملك لك وحدك، أم للعائلة (ملكية مشتركة)، أم لشركة، أم لتعاونية؟ | NEEDS §3 |
| A1.4 | Vous avez l'autorisation de l'ONSSA ? Depuis quand ? | هل لديك ترخيص من المكتب الوطني للسلامة الصحية (ONSSA)؟ ومنذ متى؟ | Q6 |
| A1.5 | Combien de personnes travaillent avec vous ? Elles habitent à la ferme ? | كم شخصاً يعمل معك؟ وهل يسكنون في الضيعة؟ | H6 |

### A2. The last batch, start to finish (15 min). This is the core of the interview
_Ask the farmer to tell the story of the **last finished batch**, step by step. Probe each step._

| # | FR | العربية | Tests |
|---|---|---|---|
| A2.1 | Racontez-moi votre dernière bande, depuis la commande des poussins jusqu'à la vente. | احكِ لي عن آخر دفعة أنهيتها، من طلب الكتاكيت إلى البيع. | All |
| A2.2 | Comment vous avez choisi la date de mise en place ? Vous avez pensé à la date de vente (Ramadan, Aïd…) ? | كيف اخترت تاريخ إدخال الكتاكيت؟ وهل فكرت في تاريخ البيع (رمضان، العيد…)؟ | SCOPE 3, 19 |
| A2.3 | À l'arrivée des poussins, vous vérifiez quoi ? Il y a déjà eu un problème avec le couvoir ? | عند وصول الكتاكيت، ماذا تتحقق منه؟ وهل سبق أن واجهت مشكلة مع المفقس؟ | SCOPE 5 |
| A2.4 | Chaque jour, qu'est-ce qui est noté ? Par qui ? Où (cahier, téléphone, WhatsApp, rien) ? Je peux voir ? | ما الذي يُسجَّل كل يوم؟ ومن يسجله؟ وأين: في دفتر، في الهاتف، في واتساب، أم لا شيء؟ هل يمكنني أن أراه؟ | **H6, Q3** |
| A2.5 | Vous pesez les poulets pendant la bande ? Comment, et tous les combien ? | هل تزن الدجاج خلال فترة التربية؟ كيف، وكل كم يوماً؟ | SCOPE 6 |
| A2.6 | Combien de morts sur la dernière bande ? Vous savez pourquoi ? | كم عدد النافق في الدفعة الأخيرة؟ وهل تعرف السبب؟ | SCOPE 6, 9 |
| A2.7 | Qu'est-ce qui s'est mal passé sur cette bande ? Qu'est-ce que ça vous a coûté ? | ما الذي لم يسر على ما يرام في هذه الدفعة؟ وكم كلّفك ذلك؟ | Pain |
| A2.8 | La chaleur de l'été / les coupures d'électricité : qu'est-ce qui s'est passé la dernière fois ? | حرارة الصيف أو انقطاع الكهرباء: ماذا حدث في آخر مرة؟ | SCOPE 8 |

### A3. Feed & inputs (5 min)
| # | FR | العربية | Tests |
|---|---|---|---|
| A3.1 | L'aliment, vous l'achetez prêt ou vous le fabriquez vous-même (maïs, soja, CMV) ? | هل تشتري العلف جاهزاً أم تخلطه بنفسك (ذرة، صويا، مركّب معدني وفيتاميني)؟ | **Q1** |
| A3.2 | Vous payez l'aliment comment : comptant, ou à crédit jusqu'à la vente ? Avec quel fournisseur ? | كيف تدفع ثمن العلف: نقداً، أم بالدَّين إلى حين البيع؟ ومع أي مورّد تتعامل؟ | **H2** |
| A3.3 | Et les poussins, les vaccins, le gaz : même chose ? | وماذا عن الكتاكيت واللقاحات وغاز التدفئة: هل هو نفس الشيء؟ | H2 |
| A3.4 | Combien vous a coûté l'aliment sur la dernière bande, à peu près ? | كم كلّفك العلف تقريباً في الدفعة الأخيرة؟ | H1 |

### A4. Health & vet (5 min)
| # | FR | العربية | Tests |
|---|---|---|---|
| A4.1 | Vous avez un vétérinaire attitré ? Il vient tous les combien ? Vous le payez comment (visite, contrat, avec l'aliment) ? | هل لديك طبيب بيطري معتمد؟ كل كم يزورك؟ وكيف تدفع له: عن كل زيارة، بعقد، أم ضمن ثمن العلف؟ | **Q5** |
| A4.2 | Le programme de vaccins, qui le décide ? Comment vous savez quand vacciner ? | من يحدد برنامج التلقيح؟ وكيف تعرف موعد كل لقاح؟ | SCOPE 9 |
| A4.3 | Vous tenez un registre d'élevage ? Je peux le voir ? Qui le remplit ? | هل تمسك سجل التربية (السجل الصحي)؟ هل يمكنني أن أراه؟ ومن يملؤه؟ | **H3, Q6** |
| A4.4 | Lors du dernier contrôle de l'ONSSA, qu'est-ce qu'on vous a demandé ? | في آخر مراقبة من المكتب الوطني للسلامة الصحية، ماذا طُلب منك؟ | **Q6** |
| A4.5 | Pour les traitements, vous respectez le délai avant la vente ? Comment vous le suivez ? | بعد إعطاء الدواء، هل تحترم مدة الانتظار قبل البيع؟ وكيف تتابعها؟ | SCOPE 9 |

### A5. Sale & money (8 min)
| # | FR | العربية | Tests |
|---|---|---|---|
| A5.1 | À qui avez-vous vendu la dernière bande ? Comment s'est fixé le prix ? | لمن بعت الدفعة الأخيرة؟ وكيف تم الاتفاق على السعر؟ | H5 |
| A5.2 | Comment vous connaissez le prix du jour ? (SMS FISA, téléphone, WhatsApp, souk) | كيف تعرف سعر اليوم؟ (رسالة FISA، الهاتف، واتساب، السوق) | **H5** |
| A5.3 | Vous accepteriez de partager votre prix de vente chaque jour si en échange vous voyez les prix de votre région ? Pourquoi ? | هل تقبل مشاركة سعر بيعك يومياً مقابل الاطلاع على أسعار منطقتك؟ ولماذا؟ | **H5** |
| A5.4 | Le paiement : cash, chèque, traite ? Après combien de jours ? Il y a eu des impayés ? | كيف يتم الدفع: نقداً، بشيك، أم بكمبيالة؟ وبعد كم يوماً؟ وهل حدث أن لم يُدفع لك؟ | **Q2** |
| A5.5 | La pesée : il y a souvent une différence avec l'acheteur ? De combien ? | عند الوزن، هل يوجد غالباً فرق مع المشتري؟ وكم يبلغ؟ | SCOPE 10 |
| A5.6 | Le fumier : vous le vendez ? À qui et à combien ? | فضلات الدواجن (السماد): هل تبيعها؟ لمن وبكم؟ | **Q4** |
| A5.7 | Sur la dernière bande, vous avez gagné ou perdu ? Comment vous le savez ? Combien vous coûte le kilo ? | هل ربحت أم خسرت في الدفعة الأخيرة؟ وكيف عرفت ذلك؟ وكم تبلغ تكلفة الكيلوغرام عليك؟ | **H1** |
| A5.8 | Vous avez un comptable ? Qu'est-ce qu'il vous demande ? | هل لديك محاسب؟ وماذا يطلب منك؟ | NEEDS §3 |

### A6. Phone & tools (4 min)
| # | FR | العربية | Tests |
|---|---|---|---|
| A6.1 | Quel téléphone vous utilisez ? Et vos ouvriers ? Il y a du réseau / internet à la ferme ? | ما نوع الهاتف الذي تستعمله؟ وماذا عن العمال؟ وهل تتوفر التغطية والإنترنت في الضيعة؟ | **Q3, H6** |
| A6.2 | Vous utilisez déjà une application ou Excel pour la ferme ? Laquelle, et pourquoi vous avez arrêté (si arrêté) ? | هل تستعمل تطبيقاً أو برنامج Excel لتسيير الضيعة؟ أيّها؟ ولماذا توقفت عن استعماله (إن توقفت)؟ | Benchmark |
| A6.3 | Vos ouvriers, ils lisent / écrivent ? Ils envoient des vocaux sur WhatsApp ? | هل يقرأ عمالك ويكتبون؟ وهل يرسلون رسائل صوتية عبر واتساب؟ | **H6** |

### A7. Priorities & value (5 min). Only now can you talk about solutions
| # | FR | العربية | Tests |
|---|---|---|---|
| A7.1 | Si vous pouviez régler un seul problème de votre élevage demain, ce serait lequel ? | لو استطعت حل مشكلة واحدة فقط في تربيتك غداً، فما هي؟ | Priority |
| A7.2 | **Card sort:** voici 10 cartes, classez les 3 plus importantes pour vous. | **ترتيب البطاقات:** هذه 10 بطاقات، رتّب الثلاث الأهم بالنسبة لك. | Priority |
| A7.3 | Combien vous payez aujourd'hui pour le véto, le comptable, les conseils ? | كم تدفع حالياً للطبيب البيطري والمحاسب والاستشارات؟ | **H1** (anchor) |
| A7.4 | Quelqu'un d'autre devrait payer l'outil ? (fournisseur d'aliment, intégrateur, coopérative) | هل يجب أن يتحمل طرف آخر تكلفة هذه الأداة؟ (مورّد العلف، الشركة المندمجة، التعاونية) | H7 |
| A7.5 | On peut revenir vous voir pour tester une première version ? Qui d'autre on devrait voir ? | هل يمكننا العودة إليك لتجربة نسخة أولى؟ ومن غيرك تنصحنا بلقائه؟ | Follow-up |

**Card-sort cards** (print in both languages, one card each):

| # | FR | العربية |
|---|---|---|
| 1 | Connaître mon coût du kilo et ma marge | معرفة تكلفة الكيلوغرام وهامش الربح |
| 2 | Savoir le bon prix et le bon moment pour vendre | معرفة السعر المناسب والوقت المناسب للبيع |
| 3 | Ne jamais oublier un vaccin / traitement | عدم نسيان أي لقاح أو علاج |
| 4 | Avoir le registre ONSSA toujours prêt | سجل ONSSA جاهز دائماً |
| 5 | Suivre mes dettes (aliment) et ce qu'on me doit | تتبّع ديوني (العلف) والمبالغ المستحقة لي |
| 6 | Être alerté en cas de mortalité / chaleur / panne | تلقي تنبيه عند ارتفاع النفوق أو الحرارة أو حدوث عطل |
| 7 | Suivre le travail de mes ouvriers | متابعة عمل العمال |
| 8 | Trouver des acheteurs sans intermédiaires | إيجاد مشترين دون وسطاء |
| 9 | Préparer un dossier pour la banque / subvention | إعداد ملف للبنك أو للدعم |
| 10 | Comparer mes bandes et mes fournisseurs | مقارنة دفعاتي ومورّديّ |

---

## 3. Guide B: Private vet (poultry)

| # | FR | العربية | Tests |
|---|---|---|---|
| B1 | Combien d'élevages avicoles vous suivez ? Quels types et quelles tailles ? | كم عدد ضيعات الدواجن التي تتابعها؟ وما أنواعها وأحجامها؟ | Profile |
| B2 | Racontez votre dernière visite d'élevage : ce que vous avez regardé, noté, prescrit. | احكِ لي عن آخر زيارة قمت بها: ماذا فحصت، وماذا سجلت، وماذا وصفت؟ | **H3** |
| B3 | Comment vous gardez la trace de vos visites et ordonnances ? (papier, carnet, téléphone) | كيف تحتفظ بأثر زياراتك ووصفاتك؟ (ورق، دفتر، هاتف) | **H3** |
| B4 | Le registre de l'éleveur : en général, il est à jour ? Qu'est-ce qui manque le plus souvent ? | هل يكون سجل المربي محيّناً عادةً؟ وما الذي ينقصه في أغلب الأحيان؟ | **Q6** |
| B5 | Lors d'un contrôle ONSSA, quels documents sont demandés ? Qu'est-ce qui pose problème ? | عند مراقبة ONSSA، ما الوثائق المطلوبة؟ وأين تكمن الصعوبات؟ | **Q6** |
| B6 | Vous êtes payé comment ? Par visite, contrat annuel, via le fournisseur d'aliment ou de médicaments ? | كيف تتقاضى أجرك: عن كل زيارة، بعقد سنوي، أم عن طريق مورّد العلف أو الأدوية؟ | **Q5** |
| B7 | Combien d'appels d'éleveurs par semaine ? Pour quoi surtout ? Ils envoient des photos / vocaux ? | كم مكالمة تتلقاها من المربين أسبوعياً؟ وفي أي مواضيع غالباً؟ وهل يرسلون صوراً أو رسائل صوتية؟ | H6 |
| B8 | Si vous pouviez voir en direct la mortalité et la consommation de vos élevages, qu'est-ce que vous en feriez ? | لو كان بإمكانك متابعة النفوق واستهلاك العلف في الضيعات التي تتابعها بشكل مباشر، ماذا ستفعل بهذه المعلومات؟ | **H3** |
| B9 | Signer / valider un registre ou une ordonnance sur le téléphone : ça vous poserait un problème ? (légal, pratique) | هل لديك مانع من توقيع السجل أو الوصفة أو المصادقة عليهما عبر الهاتف؟ (من الناحية القانونية أو العملية) | **H3** |
| B10 | Les délais d'attente après traitement : comment vous vous assurez qu'ils sont respectés ? | كيف تتأكد من احترام مدة الانتظار بعد العلاج؟ | SCOPE 9 |
| B11 | Quelles maladies vous inquiètent le plus en ce moment ? Comment se passe une déclaration ? | ما الأمراض التي تقلقك أكثر حالياً؟ وكيف تتم عملية التصريح بها؟ | SCOPE 9, 18 |
| B12 | Vous recommanderiez un outil à vos éleveurs ? À quelle condition ? | هل توصي المربين الذين تتابعهم باستعمال أداة رقمية؟ وبأي شرط؟ | Channel |

---

## 4. Guide C: Cooperative (president / treasurer / manager)

| # | FR | العربية | Tests |
|---|---|---|---|
| C1 | Combien de membres ? Qu'est-ce que la coopérative fait pour eux (achats, vente, abattage, conseil) ? | كم عدد أعضاء التعاونية؟ وما الخدمات التي تقدمها لهم: الشراء، البيع، الذبح، الإرشاد؟ | Profile |
| C2 | Qui tient la comptabilité ? Avec quel outil ? Vous utilisez le plan comptable des coopératives ? | من يمسك الحسابات؟ وبأي أداة؟ وهل تستعملون المخطط المحاسبي الخاص بالتعاونيات؟ | **H4** |
| C3 | La dernière assemblée générale : qu'est-ce qu'il a fallu préparer ? Combien de temps ? Qu'est-ce qui a été difficile ? | في آخر جمع عام: ماذا كان عليكم تحضيره؟ وكم استغرق ذلك من الوقت؟ وما الذي كان صعباً؟ | **H4** |
| C4 | Les obligations envers l'ODCO / les impôts : qu'est-ce qui vous pose problème ? | ما الصعوبات التي تواجهكم في الالتزامات تجاه مكتب تنمية التعاون (ODCO) وإدارة الضرائب؟ | **H4** |
| C5 | Comment vous suivez ce que chaque membre apporte et achète ? Et la répartition des excédents (ristournes) ? | كيف تتابعون ما يقدّمه كل عضو وما يشتريه؟ وكيف توزّعون الفائض على الأعضاء؟ | **H4** |
| C6 | La coopérative achète l'aliment pour les membres ? À crédit ? Comment vous récupérez l'argent ? | هل تشتري التعاونية العلف لأعضائها؟ وهل يكون ذلك بالدَّين؟ وكيف تسترجعون المبالغ؟ | **H2, Q1** |
| C7 | Vous vendez ensemble ? Comment se fixe le prix ? Comment les acheteurs paient ? | هل تبيعون بشكل جماعي؟ وكيف يُحدَّد السعر؟ وكيف يدفع المشترون؟ | **H5, Q2** |
| C8 | Les membres accepteraient de partager leurs données (prix, mortalité) dans la coopérative ? | هل يقبل الأعضاء مشاركة معطياتهم (الأسعار، النفوق) داخل التعاونية؟ | H5 |
| C9 | Qui pourrait payer un outil : la coopérative, chaque membre, un programme d'appui ? | من يمكنه تحمل تكلفة أداة كهذه: التعاونية، كل عضو، أم برنامج دعم؟ | Pricing |

---

## 5. Guide D: Integrator / feed mill / hatchery

| # | FR | العربية | Tests |
|---|---|---|---|
| D1 | Avec combien d'éleveurs vous travaillez ? Sous quelle forme (contrat d'intégration, agrégation loi 04-12, vente simple d'aliment / poussins) ? | مع كم مربياً تتعاملون؟ وبأي صيغة: عقد إدماج، مشروع تجميع (القانون 04-12)، أم مجرد بيع العلف والكتاكيت؟ | Profile |
| D2 | Qu'est-ce que vous fournissez à l'éleveur à crédit ? Comment vous êtes remboursés ? | ما الذي تقدمونه للمربي بالدَّين؟ وكيف تسترجعون مستحقاتكم؟ | **H2** |
| D3 | Aujourd'hui, comment vous savez ce qui se passe dans les élevages (mortalité, poids, consommation) ? Combien de techniciens ? | كيف تعرفون حالياً ما يجري في الضيعات (النفوق، الوزن، الاستهلاك)؟ وكم عدد التقنيين لديكم؟ | **Q7** |
| D4 | Quels indicateurs vous regardez par élevage ? À quelle fréquence ? | ما المؤشرات التي تتابعونها لكل ضيعة؟ وبأي وتيرة؟ | **Q7, H1** |
| D5 | Racontez la dernière fois qu'un problème dans un élevage vous a coûté cher. Vous auriez pu le voir plus tôt ? | احكِ لي عن آخر مرة كلّفتكم فيها مشكلة في إحدى الضيعات الكثير. هل كان بالإمكان اكتشافها مبكراً؟ | **Q7** |
| D6 | Qui saisit les données chez les éleveurs ? Les éleveurs utilisent quels téléphones ? | من يُدخل المعطيات لدى المربين؟ وما أنواع الهواتف التي يستعملونها؟ | **H6, Q3** |
| D7 | Les éleveurs fabriquent leur aliment ou achètent ? Ça évolue ? | هل يصنع المربون علفهم بأنفسهم أم يشترونه؟ وهل يتغير ذلك مع الوقت؟ | **Q1** |
| D8 | Vous avez déjà un logiciel (ERP, appli technique) ? Qu'est-ce qui manque ? | هل لديكم برنامج معلوماتي (نظام تسيير أو تطبيق تقني)؟ وما الذي ينقصه؟ | Benchmark |
| D9 | Vous payeriez pour un outil qui suit tous vos éleveurs ? Par élevage, par bande ? Vous l'imposeriez à vos éleveurs ? | هل ستدفعون مقابل أداة تتابع جميع مربيكم؟ عن كل ضيعة أم عن كل دفعة؟ وهل ستفرضونها على المربين؟ | **H7** |
| D10 | Traçabilité : qu'est-ce que vos clients (abattoirs, GMS, export) vous demandent ? | في مجال التتبع: ماذا يطلب منكم زبناؤكم (المجازر، المتاجر الكبرى، التصدير)؟ | SCOPE 21 |

---

## 6. Observation checklist (farm visit, with permission)

| What to observe / photograph | العربية | Why |
|---|---|---|
| Daily notebook or register | الدفتر اليومي أو سجل التربية | H6, Q6: real data format |
| Chick delivery note, feed invoice | وصل تسليم الكتاكيت، فاتورة العلف | SCOPE 5, 14 |
| Controller / thermometer / scale brand | علامة جهاز التحكم، ميزان الحرارة، الميزان | SCOPE 8, integrations |
| Generator, silo, cooling pads | المولد الكهربائي، صومعة العلف، ألواح التبريد | SCOPE 2, 8 |
| Footbath, visitor log, dead-bird pit or incinerator | حوض تطهير الأقدام، سجل الزوار، حفرة أو محرقة الطيور النافقة | SCOPE 4, 13 |
| Phones in use (owner, worker) | الهواتف المستعملة (المالك، العمال) | Q3 |

---

## 7. Synthesis grid (one row per interview)

Fill in on the same day. Code: **✓** confirmed · **~** partial · **✗** rejected · **–** not asked.

| ID | Date | Segment | Region | Size | Legal form | H1 | H2 | H3 | H4 | H5 | H6 | H7 | Q1 own feed? | Q2 payment / delay | Q3 who enters / phone | Q4 manure DH | Q5 vet visits / pay | Q6 docs asked | Top-3 cards | Best quote | Follow-up? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F01 | | Broiler | | | | | | | | | | | | | | | | | | | |
| V01 | | Vet | | | | | | | | | | | | | | | | | | | |
| C01 | | Coop | | | | | | | | | | | | | | | | | | | |
| I01 | | Integrator | | | | | | | | | | | | | | | | | | | |

**Decision rules after round 1**
- **Validated:** ≥ 60% ✓ in the target segments.
- **Rejected:** ≥ 60% ✗.
- Anything else → refine the question for round 2.
- The **card-sort top 3** across all farmers defines the MVP priority order in SCOPE §5.
- Each **pain with a cost in DH** (A2.7, D5) goes into a "cost of the problem" list. It is the basis for pricing.
