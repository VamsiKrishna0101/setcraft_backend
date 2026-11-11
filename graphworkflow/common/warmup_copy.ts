// Warm-up copy is generated on the server and validated verbatim, so it is
// localized here rather than relying on client-side string lookup.
export type WarmupCopyKey =
  | "note"
  | "pulseGym"
  | "pulseHome"
  | "pulseGentle"
  | "mobLower"
  | "mobLowerSafe"
  | "mobPush"
  | "mobPushSafe"
  | "mobPull"
  | "mobPullStanding"
  | "mobFull"
  | "mobFullStanding"
  | "actBridges"
  | "actBridgesSquats"
  | "actWallPush"
  | "actInclinePush"
  | "actBandPullApart"
  | "actYtw"
  | "actScapPull"
  | "actFullGentle"
  | "actFull"
  | "rampLight"
  | "rampHeavy"
  | "rehearsalLoad"
  | "rehearsalFree";

type Entry = { name: string; instruction: string };
type Copy = Record<WarmupCopyKey, Entry>;

const en: Copy = {
  note: { name: "", instruction: "Preparation only. These sets do not count towards working sets or records. Keep them easy and stop if anything causes pain." },
  pulseGym: { name: "Easy cardio", instruction: "Bike, row or walk briskly at an easy pace for 60 seconds. You should be able to talk." },
  pulseHome: { name: "Easy cardio", instruction: "March in place, then step side to side for 60 seconds. Keep it easy enough to talk." },
  pulseGentle: { name: "Easy cardio", instruction: "Walk or march gently for 60 seconds using a movement that feels comfortable for you." },
  mobLower: { name: "Leg swings & hip circles", instruction: "Do 8 front-to-back and 8 side-to-side leg swings per leg, holding a support, then slow hip circles." },
  mobLowerSafe: { name: "Supported leg swings & ankle rocks", instruction: "Hold a support and swing each leg gently in a small, comfortable range, then rock your knee over your toes 8 times per side." },
  mobPush: { name: "Arm circles & wall slides", instruction: "Do 10 arm circles each way, then slide your forearms up a wall 8 times, keeping your ribs down." },
  mobPushSafe: { name: "Small arm circles & wall slides", instruction: "Make small, slow arm circles in a pain-free range, then do 6 gentle wall slides only as high as feels comfortable." },
  mobPull: { name: "Cat-cow & upper-back rotations", instruction: "Do 6 slow cat-cow reps on hands and knees, then 6 upper-back rotations per side." },
  mobPullStanding: { name: "Standing upper-back rotations", instruction: "Stand tall with arms crossed and rotate your upper back gently 8 times per side, keeping your hips still." },
  mobFull: { name: "Cat-cow, leg swings & arm circles", instruction: "Do 5 slow cat-cow reps, 6 leg swings per leg holding a support, then 8 arm circles each way." },
  mobFullStanding: { name: "Standing mobility flow", instruction: "Do 8 standing upper-back rotations per side, 6 supported leg swings per leg, then small arm circles." },
  actBridges: { name: "Glute bridges", instruction: "Lie on your back, feet flat, and lift your hips 10 times. Pause and squeeze at the top." },
  actBridgesSquats: { name: "Glute bridges & bodyweight squats", instruction: "Do 10 glute bridges, then 8 slow bodyweight squats to a comfortable depth with knees following your toes." },
  actWallPush: { name: "Wall push-ups", instruction: "Do 10 slow push-ups against a wall. Keep your body in one line and shoulder blades moving freely." },
  actInclinePush: { name: "Incline push-ups", instruction: "Do 8 push-ups with your hands on a sturdy raised surface. Stop 3–4 reps before it gets hard." },
  actBandPullApart: { name: "Band pull-aparts", instruction: "Hold a light band at shoulder height and pull it apart 15 times, squeezing your shoulder blades together." },
  actYtw: { name: "Prone Y-T-W raises", instruction: "Lie face down and lift your arms into a Y, T and W shape, 5 slow reps each. No equipment needed." },
  actScapPull: { name: "Scapular pulls", instruction: "Hang from the bar and pull your shoulder blades down and back 8 times without bending your elbows." },
  actFullGentle: { name: "Glute bridges & wall push-ups", instruction: "Do 10 glute bridges, then 10 slow wall push-ups." },
  actFull: { name: "Glute bridges & incline push-ups", instruction: "Do 10 glute bridges, then 8 incline push-ups with your hands on a sturdy raised surface." },
  rampLight: { name: "", instruction: "Ramp-up set 1: 8 easy reps at about half your working weight. Focus on clean technique." },
  rampHeavy: { name: "", instruction: "Ramp-up set 2: 3 crisp reps at about three quarters of your working weight. Rest about a minute before your first working set." },
  rehearsalLoad: { name: "", instruction: "Practice set: 8 smooth reps at a light weight to rehearse the movement before your working sets." },
  rehearsalFree: { name: "", instruction: "Practice set: 8 smooth reps with a very light weight or an easier version of this exercise." },
};

const de: Copy = {
  note: { name: "", instruction: "Nur zur Vorbereitung. Diese Sätze zählen nicht zu Arbeitssätzen oder Bestleistungen. Bleib locker und hör auf, wenn etwas schmerzt." },
  pulseGym: { name: "Lockeres Cardio", instruction: "60 Sekunden locker Rad fahren, rudern oder zügig gehen. Du solltest dabei noch sprechen können." },
  pulseHome: { name: "Lockeres Cardio", instruction: "60 Sekunden auf der Stelle marschieren, dann seitlich steppen. So locker, dass du noch sprechen kannst." },
  pulseGentle: { name: "Lockeres Cardio", instruction: "60 Sekunden ruhig gehen oder marschieren, mit einer Bewegung, die sich für dich angenehm anfühlt." },
  mobLower: { name: "Beinschwünge & Hüftkreisen", instruction: "Pro Bein 8 Schwünge vor und zurück und 8 seitlich, mit Halt an einer Stütze, danach langsames Hüftkreisen." },
  mobLowerSafe: { name: "Gestützte Beinschwünge & Sprunggelenk-Wippen", instruction: "Halte dich fest und schwinge jedes Bein sanft in einem kleinen, angenehmen Bereich. Dann 8-mal pro Seite das Knie über die Zehen schieben." },
  mobPush: { name: "Armkreisen & Wall Slides", instruction: "10 Armkreise in jede Richtung, dann 8-mal die Unterarme an der Wand nach oben schieben, Rippen unten halten." },
  mobPushSafe: { name: "Kleine Armkreise & Wall Slides", instruction: "Kleine, langsame Armkreise im schmerzfreien Bereich, dann 6 sanfte Wall Slides nur so hoch, wie es angenehm ist." },
  mobPull: { name: "Katze-Kuh & Rotationen im oberen Rücken", instruction: "6 langsame Katze-Kuh-Wiederholungen im Vierfüßlerstand, dann 6 Rotationen des oberen Rückens pro Seite." },
  mobPullStanding: { name: "Rotationen im Stand", instruction: "Aufrecht stehen, Arme verschränken und den oberen Rücken 8-mal pro Seite sanft drehen. Hüfte bleibt ruhig." },
  mobFull: { name: "Katze-Kuh, Beinschwünge & Armkreisen", instruction: "5 langsame Katze-Kuh-Wiederholungen, 6 gestützte Beinschwünge pro Bein, dann 8 Armkreise in jede Richtung." },
  mobFullStanding: { name: "Mobilität im Stand", instruction: "8 Rotationen des oberen Rückens pro Seite im Stand, 6 gestützte Beinschwünge pro Bein, dann kleine Armkreise." },
  actBridges: { name: "Glute Bridges", instruction: "In Rückenlage, Füße aufgestellt, die Hüfte 10-mal anheben. Oben kurz halten und anspannen." },
  actBridgesSquats: { name: "Glute Bridges & Kniebeugen", instruction: "10 Glute Bridges, dann 8 langsame Kniebeugen mit Körpergewicht in angenehmer Tiefe. Knie folgen den Zehen." },
  actWallPush: { name: "Liegestütze an der Wand", instruction: "10 langsame Liegestütze an der Wand. Körper bleibt in einer Linie, Schulterblätter bewegen sich frei." },
  actInclinePush: { name: "Erhöhte Liegestütze", instruction: "8 Liegestütze mit den Händen auf einer stabilen Erhöhung. 3–4 Wiederholungen vor der Anstrengung aufhören." },
  actBandPullApart: { name: "Band Pull-Aparts", instruction: "Ein leichtes Band auf Schulterhöhe 15-mal auseinanderziehen und die Schulterblätter zusammenführen." },
  actYtw: { name: "Y-T-W-Heben in Bauchlage", instruction: "In Bauchlage die Arme zu Y, T und W anheben, je 5 langsame Wiederholungen. Ohne Ausrüstung." },
  actScapPull: { name: "Schulterblatt-Züge", instruction: "An der Stange hängen und die Schulterblätter 8-mal nach unten und hinten ziehen, ohne die Arme zu beugen." },
  actFullGentle: { name: "Glute Bridges & Wand-Liegestütze", instruction: "10 Glute Bridges, dann 10 langsame Liegestütze an der Wand." },
  actFull: { name: "Glute Bridges & erhöhte Liegestütze", instruction: "10 Glute Bridges, dann 8 Liegestütze mit den Händen auf einer stabilen Erhöhung." },
  rampLight: { name: "", instruction: "Aufwärmsatz 1: 8 leichte Wiederholungen mit etwa der Hälfte deines Arbeitsgewichts. Achte auf saubere Technik." },
  rampHeavy: { name: "", instruction: "Aufwärmsatz 2: 3 zügige Wiederholungen mit etwa drei Vierteln deines Arbeitsgewichts. Dann etwa eine Minute Pause." },
  rehearsalLoad: { name: "", instruction: "Übungssatz: 8 flüssige Wiederholungen mit leichtem Gewicht, um die Bewegung vor den Arbeitssätzen zu üben." },
  rehearsalFree: { name: "", instruction: "Übungssatz: 8 flüssige Wiederholungen mit sehr leichtem Gewicht oder einer leichteren Variante dieser Übung." },
};

const fr: Copy = {
  note: { name: "", instruction: "Préparation uniquement. Ces séries ne comptent pas comme séries de travail ni comme records. Restez léger et arrêtez en cas de douleur." },
  pulseGym: { name: "Cardio léger", instruction: "Vélo, rameur ou marche rapide à allure facile pendant 60 secondes. Vous devez pouvoir parler." },
  pulseHome: { name: "Cardio léger", instruction: "Marchez sur place puis faites des pas chassés pendant 60 secondes, assez doucement pour pouvoir parler." },
  pulseGentle: { name: "Cardio léger", instruction: "Marchez doucement pendant 60 secondes avec un mouvement confortable pour vous." },
  mobLower: { name: "Balancements de jambes & cercles de hanches", instruction: "8 balancements avant-arrière et 8 latéraux par jambe en vous tenant à un appui, puis des cercles de hanches lents." },
  mobLowerSafe: { name: "Balancements soutenus & mobilité de cheville", instruction: "Tenez un appui et balancez chaque jambe doucement dans une petite amplitude confortable, puis avancez le genou au-dessus des orteils 8 fois par côté." },
  mobPush: { name: "Cercles de bras & glissés au mur", instruction: "10 cercles de bras dans chaque sens, puis faites glisser les avant-bras le long d'un mur 8 fois, côtes basses." },
  mobPushSafe: { name: "Petits cercles de bras & glissés au mur", instruction: "Petits cercles lents sans douleur, puis 6 glissés au mur doux, seulement aussi haut que c'est confortable." },
  mobPull: { name: "Chat-vache & rotations du haut du dos", instruction: "6 chat-vache lents à quatre pattes, puis 6 rotations du haut du dos par côté." },
  mobPullStanding: { name: "Rotations debout", instruction: "Debout, bras croisés, tournez doucement le haut du dos 8 fois par côté en gardant les hanches immobiles." },
  mobFull: { name: "Chat-vache, balancements & cercles de bras", instruction: "5 chat-vache lents, 6 balancements soutenus par jambe, puis 8 cercles de bras dans chaque sens." },
  mobFullStanding: { name: "Mobilité debout", instruction: "8 rotations du haut du dos par côté, 6 balancements soutenus par jambe, puis de petits cercles de bras." },
  actBridges: { name: "Ponts fessiers", instruction: "Allongé sur le dos, pieds à plat, montez les hanches 10 fois. Marquez une pause en haut en serrant les fessiers." },
  actBridgesSquats: { name: "Ponts fessiers & squats au poids du corps", instruction: "10 ponts fessiers, puis 8 squats lents à une profondeur confortable, genoux dans l'axe des orteils." },
  actWallPush: { name: "Pompes au mur", instruction: "10 pompes lentes contre un mur, corps aligné et omoplates libres." },
  actInclinePush: { name: "Pompes inclinées", instruction: "8 pompes les mains sur un support stable surélevé. Arrêtez 3 à 4 répétitions avant la difficulté." },
  actBandPullApart: { name: "Écartés à l'élastique", instruction: "Tenez un élastique léger à hauteur d'épaules et écartez-le 15 fois en serrant les omoplates." },
  actYtw: { name: "Élévations Y-T-W à plat ventre", instruction: "À plat ventre, levez les bras en Y, T puis W, 5 répétitions lentes chacun. Sans matériel." },
  actScapPull: { name: "Tirages scapulaires", instruction: "Suspendu à la barre, abaissez et resserrez les omoplates 8 fois sans plier les coudes." },
  actFullGentle: { name: "Ponts fessiers & pompes au mur", instruction: "10 ponts fessiers, puis 10 pompes lentes au mur." },
  actFull: { name: "Ponts fessiers & pompes inclinées", instruction: "10 ponts fessiers, puis 8 pompes les mains sur un support stable surélevé." },
  rampLight: { name: "", instruction: "Série d'approche 1 : 8 répétitions faciles à environ la moitié de votre charge de travail. Soignez la technique." },
  rampHeavy: { name: "", instruction: "Série d'approche 2 : 3 répétitions nettes à environ trois quarts de votre charge de travail. Reposez-vous environ une minute." },
  rehearsalLoad: { name: "", instruction: "Série d'essai : 8 répétitions fluides avec une charge légère pour répéter le mouvement." },
  rehearsalFree: { name: "", instruction: "Série d'essai : 8 répétitions fluides avec une charge très légère ou une version plus facile de l'exercice." },
};

const es: Copy = {
  note: { name: "", instruction: "Solo preparación. Estas series no cuentan como series de trabajo ni récords. Hazlas suaves y para si algo duele." },
  pulseGym: { name: "Cardio suave", instruction: "Bici, remo o caminata rápida a ritmo fácil durante 60 segundos. Deberías poder hablar." },
  pulseHome: { name: "Cardio suave", instruction: "Marcha en el sitio y luego pasos laterales durante 60 segundos, lo bastante suave para poder hablar." },
  pulseGentle: { name: "Cardio suave", instruction: "Camina o marcha suavemente durante 60 segundos con un movimiento que te resulte cómodo." },
  mobLower: { name: "Balanceos de pierna y círculos de cadera", instruction: "8 balanceos adelante-atrás y 8 laterales por pierna sujetándote a un apoyo, luego círculos lentos de cadera." },
  mobLowerSafe: { name: "Balanceos con apoyo y movilidad de tobillo", instruction: "Sujétate y balancea cada pierna suavemente en un rango pequeño y cómodo; luego lleva la rodilla sobre los dedos 8 veces por lado." },
  mobPush: { name: "Círculos de brazos y deslizamientos en pared", instruction: "10 círculos de brazos en cada sentido y luego desliza los antebrazos por la pared 8 veces, costillas abajo." },
  mobPushSafe: { name: "Círculos pequeños y deslizamientos en pared", instruction: "Círculos pequeños y lentos sin dolor, luego 6 deslizamientos suaves en pared solo hasta donde sea cómodo." },
  mobPull: { name: "Gato-vaca y rotaciones de espalda alta", instruction: "6 gato-vaca lentos en cuadrupedia y luego 6 rotaciones de espalda alta por lado." },
  mobPullStanding: { name: "Rotaciones de pie", instruction: "De pie, brazos cruzados, gira suavemente la espalda alta 8 veces por lado con la cadera quieta." },
  mobFull: { name: "Gato-vaca, balanceos y círculos de brazos", instruction: "5 gato-vaca lentos, 6 balanceos con apoyo por pierna y 8 círculos de brazos en cada sentido." },
  mobFullStanding: { name: "Movilidad de pie", instruction: "8 rotaciones de espalda alta por lado, 6 balanceos con apoyo por pierna y círculos pequeños de brazos." },
  actBridges: { name: "Puentes de glúteo", instruction: "Boca arriba, pies apoyados, sube la cadera 10 veces. Pausa y aprieta arriba." },
  actBridgesSquats: { name: "Puentes de glúteo y sentadillas", instruction: "10 puentes de glúteo y luego 8 sentadillas lentas con peso corporal a una profundidad cómoda, rodillas alineadas con los pies." },
  actWallPush: { name: "Flexiones en pared", instruction: "10 flexiones lentas contra la pared, cuerpo en línea y escápulas libres." },
  actInclinePush: { name: "Flexiones inclinadas", instruction: "8 flexiones con las manos en una superficie elevada y estable. Para 3–4 repeticiones antes de que cueste." },
  actBandPullApart: { name: "Aperturas con banda", instruction: "Sujeta una banda ligera a la altura de los hombros y sepárala 15 veces juntando las escápulas." },
  actYtw: { name: "Elevaciones Y-T-W boca abajo", instruction: "Boca abajo, eleva los brazos en Y, T y W, 5 repeticiones lentas de cada una. Sin material." },
  actScapPull: { name: "Retracciones escapulares", instruction: "Colgado de la barra, baja y junta las escápulas 8 veces sin doblar los codos." },
  actFullGentle: { name: "Puentes de glúteo y flexiones en pared", instruction: "10 puentes de glúteo y luego 10 flexiones lentas en pared." },
  actFull: { name: "Puentes de glúteo y flexiones inclinadas", instruction: "10 puentes de glúteo y luego 8 flexiones con las manos en una superficie elevada y estable." },
  rampLight: { name: "", instruction: "Serie de aproximación 1: 8 repeticiones fáciles con aproximadamente la mitad de tu peso de trabajo. Cuida la técnica." },
  rampHeavy: { name: "", instruction: "Serie de aproximación 2: 3 repeticiones rápidas con aproximadamente tres cuartos de tu peso de trabajo. Descansa un minuto." },
  rehearsalLoad: { name: "", instruction: "Serie de práctica: 8 repeticiones fluidas con peso ligero para ensayar el movimiento." },
  rehearsalFree: { name: "", instruction: "Serie de práctica: 8 repeticiones fluidas con peso muy ligero o una versión más fácil del ejercicio." },
};

const it: Copy = {
  note: { name: "", instruction: "Solo preparazione. Queste serie non contano come serie di lavoro o record. Mantienile leggere e fermati se senti dolore." },
  pulseGym: { name: "Cardio leggero", instruction: "Bici, vogatore o camminata veloce a ritmo facile per 60 secondi. Dovresti riuscire a parlare." },
  pulseHome: { name: "Cardio leggero", instruction: "Marcia sul posto e poi passi laterali per 60 secondi, abbastanza piano da poter parlare." },
  pulseGentle: { name: "Cardio leggero", instruction: "Cammina o marcia piano per 60 secondi con un movimento che ti risulti comodo." },
  mobLower: { name: "Slanci delle gambe e circonduzioni dell'anca", instruction: "8 slanci avanti-indietro e 8 laterali per gamba tenendoti a un appoggio, poi lente circonduzioni dell'anca." },
  mobLowerSafe: { name: "Slanci assistiti e mobilità della caviglia", instruction: "Tieniti a un appoggio e slancia ogni gamba piano in un'ampiezza piccola e comoda, poi porta il ginocchio sopra le dita 8 volte per lato." },
  mobPush: { name: "Circonduzioni delle braccia e wall slide", instruction: "10 circonduzioni in ogni direzione, poi fai scorrere gli avambracci lungo il muro 8 volte, costole basse." },
  mobPushSafe: { name: "Piccole circonduzioni e wall slide", instruction: "Piccole circonduzioni lente senza dolore, poi 6 wall slide delicati solo fin dove è comodo." },
  mobPull: { name: "Gatto-mucca e rotazioni della parte alta della schiena", instruction: "6 gatto-mucca lenti a quattro zampe, poi 6 rotazioni della parte alta della schiena per lato." },
  mobPullStanding: { name: "Rotazioni in piedi", instruction: "In piedi, braccia incrociate, ruota piano la parte alta della schiena 8 volte per lato tenendo ferme le anche." },
  mobFull: { name: "Gatto-mucca, slanci e circonduzioni", instruction: "5 gatto-mucca lenti, 6 slanci assistiti per gamba, poi 8 circonduzioni delle braccia per direzione." },
  mobFullStanding: { name: "Mobilità in piedi", instruction: "8 rotazioni della schiena per lato in piedi, 6 slanci assistiti per gamba, poi piccole circonduzioni delle braccia." },
  actBridges: { name: "Ponte glutei", instruction: "Supino, piedi a terra, solleva il bacino 10 volte. Fermati e contrai in alto." },
  actBridgesSquats: { name: "Ponte glutei e squat a corpo libero", instruction: "10 ponti glutei, poi 8 squat lenti a corpo libero a una profondità comoda, ginocchia in linea con le punte." },
  actWallPush: { name: "Piegamenti al muro", instruction: "10 piegamenti lenti contro il muro, corpo allineato e scapole libere." },
  actInclinePush: { name: "Piegamenti inclinati", instruction: "8 piegamenti con le mani su un appoggio rialzato e stabile. Fermati 3–4 ripetizioni prima della fatica." },
  actBandPullApart: { name: "Aperture con elastico", instruction: "Tieni un elastico leggero all'altezza delle spalle e aprilo 15 volte avvicinando le scapole." },
  actYtw: { name: "Sollevamenti Y-T-W proni", instruction: "A pancia in giù, solleva le braccia a Y, T e W, 5 ripetizioni lente ciascuna. Senza attrezzi." },
  actScapPull: { name: "Retrazioni scapolari", instruction: "Appeso alla sbarra, abbassa e avvicina le scapole 8 volte senza piegare i gomiti." },
  actFullGentle: { name: "Ponte glutei e piegamenti al muro", instruction: "10 ponti glutei, poi 10 piegamenti lenti al muro." },
  actFull: { name: "Ponte glutei e piegamenti inclinati", instruction: "10 ponti glutei, poi 8 piegamenti con le mani su un appoggio rialzato e stabile." },
  rampLight: { name: "", instruction: "Serie di avvicinamento 1: 8 ripetizioni facili a circa metà del carico di lavoro. Cura la tecnica." },
  rampHeavy: { name: "", instruction: "Serie di avvicinamento 2: 3 ripetizioni decise a circa tre quarti del carico di lavoro. Recupera circa un minuto." },
  rehearsalLoad: { name: "", instruction: "Serie di prova: 8 ripetizioni fluide con un carico leggero per provare il movimento." },
  rehearsalFree: { name: "", instruction: "Serie di prova: 8 ripetizioni fluide con un carico molto leggero o una variante più facile." },
};

const nl: Copy = {
  note: { name: "", instruction: "Alleen voorbereiding. Deze sets tellen niet als werksets of records. Houd het licht en stop als iets pijn doet." },
  pulseGym: { name: "Rustige cardio", instruction: "Fiets, roei of wandel 60 seconden stevig in een rustig tempo. Je moet nog kunnen praten." },
  pulseHome: { name: "Rustige cardio", instruction: "Marcheer op de plaats en stap daarna zijwaarts, 60 seconden, rustig genoeg om te praten." },
  pulseGentle: { name: "Rustige cardio", instruction: "Wandel of marcheer 60 seconden rustig met een beweging die prettig voelt." },
  mobLower: { name: "Beenzwaaien & heupcirkels", instruction: "8 zwaaien voor-achter en 8 zijwaarts per been met steun, daarna langzame heupcirkels." },
  mobLowerSafe: { name: "Ondersteund beenzwaaien & enkelmobiliteit", instruction: "Houd je vast en zwaai elk been zacht in een kleine, comfortabele range. Breng daarna je knie 8 keer per kant over je tenen." },
  mobPush: { name: "Armcirkels & wall slides", instruction: "10 armcirkels per richting, daarna 8 keer je onderarmen langs de muur omhoog schuiven, ribben laag." },
  mobPushSafe: { name: "Kleine armcirkels & wall slides", instruction: "Kleine, langzame armcirkels zonder pijn, daarna 6 rustige wall slides alleen zo hoog als prettig is." },
  mobPull: { name: "Kat-koe & rotaties bovenrug", instruction: "6 langzame kat-koe herhalingen op handen en knieën, daarna 6 rotaties van de bovenrug per kant." },
  mobPullStanding: { name: "Staande rotaties", instruction: "Sta rechtop met gekruiste armen en draai je bovenrug rustig 8 keer per kant, heupen stil." },
  mobFull: { name: "Kat-koe, beenzwaaien & armcirkels", instruction: "5 langzame kat-koe herhalingen, 6 ondersteunde beenzwaaien per been, daarna 8 armcirkels per richting." },
  mobFullStanding: { name: "Staande mobiliteit", instruction: "8 staande rotaties van de bovenrug per kant, 6 ondersteunde beenzwaaien per been, daarna kleine armcirkels." },
  actBridges: { name: "Glute bridges", instruction: "Lig op je rug, voeten plat, en til je heupen 10 keer op. Even vasthouden en aanspannen bovenaan." },
  actBridgesSquats: { name: "Glute bridges & squats", instruction: "10 glute bridges, daarna 8 langzame squats met lichaamsgewicht tot een comfortabele diepte, knieën in lijn met je tenen." },
  actWallPush: { name: "Push-ups tegen de muur", instruction: "10 langzame push-ups tegen de muur, lichaam in één lijn en schouderbladen vrij." },
  actInclinePush: { name: "Schuine push-ups", instruction: "8 push-ups met je handen op een stevige verhoging. Stop 3–4 herhalingen voordat het zwaar wordt." },
  actBandPullApart: { name: "Band pull-aparts", instruction: "Houd een lichte band op schouderhoogte en trek hem 15 keer uit elkaar, schouderbladen samen." },
  actYtw: { name: "Y-T-W heffen op je buik", instruction: "Lig op je buik en til je armen in een Y, T en W, 5 langzame herhalingen elk. Geen materiaal nodig." },
  actScapPull: { name: "Schouderblad-pulls", instruction: "Hang aan de stang en trek je schouderbladen 8 keer omlaag en naar achteren zonder je ellebogen te buigen." },
  actFullGentle: { name: "Glute bridges & muur-push-ups", instruction: "10 glute bridges, daarna 10 langzame push-ups tegen de muur." },
  actFull: { name: "Glute bridges & schuine push-ups", instruction: "10 glute bridges, daarna 8 push-ups met je handen op een stevige verhoging." },
  rampLight: { name: "", instruction: "Opbouwset 1: 8 makkelijke herhalingen met ongeveer de helft van je werkgewicht. Let op nette techniek." },
  rampHeavy: { name: "", instruction: "Opbouwset 2: 3 vlotte herhalingen met ongeveer driekwart van je werkgewicht. Rust daarna ongeveer een minuut." },
  rehearsalLoad: { name: "", instruction: "Oefenset: 8 vloeiende herhalingen met een licht gewicht om de beweging te oefenen." },
  rehearsalFree: { name: "", instruction: "Oefenset: 8 vloeiende herhalingen met een heel licht gewicht of een makkelijkere variant." },
};

const sv: Copy = {
  note: { name: "", instruction: "Endast förberedelse. Dessa set räknas inte som arbetsset eller rekord. Håll det lätt och avbryt om något gör ont." },
  pulseGym: { name: "Lätt kondition", instruction: "Cykla, ro eller gå raskt i lugnt tempo i 60 sekunder. Du ska kunna prata." },
  pulseHome: { name: "Lätt kondition", instruction: "Marschera på stället och ta sedan sidosteg i 60 sekunder, lugnt nog att kunna prata." },
  pulseGentle: { name: "Lätt kondition", instruction: "Gå eller marschera lugnt i 60 sekunder med en rörelse som känns bekväm." },
  mobLower: { name: "Bensving & höftcirklar", instruction: "8 sving fram-bak och 8 åt sidan per ben med stöd, sedan långsamma höftcirklar." },
  mobLowerSafe: { name: "Bensving med stöd & fotledsrörlighet", instruction: "Håll i ett stöd och sving varje ben mjukt i ett litet, bekvämt rörelseomfång. För sedan knät över tårna 8 gånger per sida." },
  mobPush: { name: "Armcirklar & wall slides", instruction: "10 armcirklar åt varje håll, för sedan underarmarna uppför väggen 8 gånger med revbenen nere." },
  mobPushSafe: { name: "Små armcirklar & wall slides", instruction: "Små, långsamma armcirklar utan smärta, sedan 6 mjuka wall slides bara så högt det känns bra." },
  mobPull: { name: "Katt-ko & rotationer i övre ryggen", instruction: "6 långsamma katt-ko på alla fyra, sedan 6 rotationer i övre ryggen per sida." },
  mobPullStanding: { name: "Stående rotationer", instruction: "Stå rak med armarna i kors och vrid övre ryggen mjukt 8 gånger per sida med stilla höfter." },
  mobFull: { name: "Katt-ko, bensving & armcirklar", instruction: "5 långsamma katt-ko, 6 bensving med stöd per ben, sedan 8 armcirklar åt varje håll." },
  mobFullStanding: { name: "Stående rörlighet", instruction: "8 stående rotationer i övre ryggen per sida, 6 bensving med stöd per ben, sedan små armcirklar." },
  actBridges: { name: "Höftlyft", instruction: "Ligg på rygg med fötterna i golvet och lyft höften 10 gånger. Pausa och spänn i toppen." },
  actBridgesSquats: { name: "Höftlyft & knäböj", instruction: "10 höftlyft, sedan 8 långsamma knäböj med kroppsvikt till bekvämt djup, knäna i linje med tårna." },
  actWallPush: { name: "Armhävningar mot vägg", instruction: "10 långsamma armhävningar mot väggen, kroppen i en linje och skulderbladen fria." },
  actInclinePush: { name: "Lutande armhävningar", instruction: "8 armhävningar med händerna på en stabil upphöjning. Sluta 3–4 repetitioner innan det blir tungt." },
  actBandPullApart: { name: "Band pull-aparts", instruction: "Håll ett lätt band i axelhöjd och dra isär det 15 gånger medan du för ihop skulderbladen." },
  actYtw: { name: "Y-T-W-lyft på mage", instruction: "Ligg på mage och lyft armarna i Y, T och W, 5 långsamma repetitioner var. Ingen utrustning behövs." },
  actScapPull: { name: "Skulderbladsdrag", instruction: "Häng i stången och dra skulderbladen nedåt och bakåt 8 gånger utan att böja armbågarna." },
  actFullGentle: { name: "Höftlyft & armhävningar mot vägg", instruction: "10 höftlyft, sedan 10 långsamma armhävningar mot väggen." },
  actFull: { name: "Höftlyft & lutande armhävningar", instruction: "10 höftlyft, sedan 8 armhävningar med händerna på en stabil upphöjning." },
  rampLight: { name: "", instruction: "Uppvärmningsset 1: 8 lätta repetitioner med ungefär halva arbetsvikten. Fokusera på ren teknik." },
  rampHeavy: { name: "", instruction: "Uppvärmningsset 2: 3 snabba repetitioner med ungefär tre fjärdedelar av arbetsvikten. Vila sedan cirka en minut." },
  rehearsalLoad: { name: "", instruction: "Övningsset: 8 mjuka repetitioner med lätt vikt för att öva rörelsen." },
  rehearsalFree: { name: "", instruction: "Övningsset: 8 mjuka repetitioner med mycket lätt vikt eller en enklare variant av övningen." },
};

const no: Copy = {
  note: { name: "", instruction: "Kun forberedelse. Disse settene teller ikke som arbeidssett eller rekorder. Hold det lett og stopp hvis noe gjør vondt." },
  pulseGym: { name: "Lett kondisjon", instruction: "Sykle, ro eller gå raskt i rolig tempo i 60 sekunder. Du skal kunne snakke." },
  pulseHome: { name: "Lett kondisjon", instruction: "Marsjer på stedet og ta deretter sidesteg i 60 sekunder, rolig nok til å kunne snakke." },
  pulseGentle: { name: "Lett kondisjon", instruction: "Gå eller marsjer rolig i 60 sekunder med en bevegelse som føles komfortabel." },
  mobLower: { name: "Beinsving & hoftesirkler", instruction: "8 sving frem-tilbake og 8 til siden per bein med støtte, deretter langsomme hoftesirkler." },
  mobLowerSafe: { name: "Beinsving med støtte & ankelmobilitet", instruction: "Hold i en støtte og sving hvert bein rolig i et lite, komfortabelt bevegelsesutslag. Før deretter kneet over tærne 8 ganger per side." },
  mobPush: { name: "Armsirkler & wall slides", instruction: "10 armsirkler hver vei, før deretter underarmene oppover veggen 8 ganger med ribbeina nede." },
  mobPushSafe: { name: "Små armsirkler & wall slides", instruction: "Små, langsomme armsirkler uten smerte, deretter 6 rolige wall slides bare så høyt det føles bra." },
  mobPull: { name: "Katt-ku & rotasjoner i øvre rygg", instruction: "6 langsomme katt-ku på alle fire, deretter 6 rotasjoner i øvre rygg per side." },
  mobPullStanding: { name: "Stående rotasjoner", instruction: "Stå rett med armene i kors og vri øvre rygg rolig 8 ganger per side med rolige hofter." },
  mobFull: { name: "Katt-ku, beinsving & armsirkler", instruction: "5 langsomme katt-ku, 6 beinsving med støtte per bein, deretter 8 armsirkler hver vei." },
  mobFullStanding: { name: "Stående mobilitet", instruction: "8 stående rotasjoner i øvre rygg per side, 6 beinsving med støtte per bein, deretter små armsirkler." },
  actBridges: { name: "Hofteløft", instruction: "Ligg på ryggen med føttene i gulvet og løft hoften 10 ganger. Pause og stram i toppen." },
  actBridgesSquats: { name: "Hofteløft & knebøy", instruction: "10 hofteløft, deretter 8 langsomme knebøy med kroppsvekt til komfortabel dybde, knærne i linje med tærne." },
  actWallPush: { name: "Armhevinger mot vegg", instruction: "10 langsomme armhevinger mot veggen, kroppen i én linje og skulderbladene frie." },
  actInclinePush: { name: "Skrå armhevinger", instruction: "8 armhevinger med hendene på en stødig forhøyning. Stopp 3–4 repetisjoner før det blir tungt." },
  actBandPullApart: { name: "Band pull-aparts", instruction: "Hold et lett strikk i skulderhøyde og dra det fra hverandre 15 ganger mens du samler skulderbladene." },
  actYtw: { name: "Y-T-W-løft på magen", instruction: "Ligg på magen og løft armene i Y, T og W, 5 langsomme repetisjoner hver. Uten utstyr." },
  actScapPull: { name: "Skulderbladtrekk", instruction: "Heng i stangen og trekk skulderbladene ned og bak 8 ganger uten å bøye albuene." },
  actFullGentle: { name: "Hofteløft & armhevinger mot vegg", instruction: "10 hofteløft, deretter 10 langsomme armhevinger mot veggen." },
  actFull: { name: "Hofteløft & skrå armhevinger", instruction: "10 hofteløft, deretter 8 armhevinger med hendene på en stødig forhøyning." },
  rampLight: { name: "", instruction: "Oppvarmingssett 1: 8 lette repetisjoner med omtrent halve arbeidsvekten. Fokuser på ren teknikk." },
  rampHeavy: { name: "", instruction: "Oppvarmingssett 2: 3 raske repetisjoner med omtrent tre firedeler av arbeidsvekten. Hvil deretter rundt ett minutt." },
  rehearsalLoad: { name: "", instruction: "Øvingssett: 8 jevne repetisjoner med lett vekt for å øve på bevegelsen." },
  rehearsalFree: { name: "", instruction: "Øvingssett: 8 jevne repetisjoner med svært lett vekt eller en enklere variant av øvelsen." },
};

const da: Copy = {
  note: { name: "", instruction: "Kun forberedelse. Disse sæt tæller ikke som arbejdssæt eller rekorder. Hold det let og stop, hvis noget gør ondt." },
  pulseGym: { name: "Let kondition", instruction: "Cykl, ro eller gå rask i roligt tempo i 60 sekunder. Du skal kunne tale." },
  pulseHome: { name: "Let kondition", instruction: "March på stedet og tag derefter sidetrin i 60 sekunder, roligt nok til at kunne tale." },
  pulseGentle: { name: "Let kondition", instruction: "Gå eller march roligt i 60 sekunder med en bevægelse, der føles behagelig." },
  mobLower: { name: "Bensving & hoftecirkler", instruction: "8 sving frem-tilbage og 8 til siden per ben med støtte, derefter langsomme hoftecirkler." },
  mobLowerSafe: { name: "Bensving med støtte & ankelmobilitet", instruction: "Hold fast i en støtte og sving hvert ben roligt i et lille, behageligt bevægeudslag. Før derefter knæet frem over tæerne 8 gange per side." },
  mobPush: { name: "Armcirkler & wall slides", instruction: "10 armcirkler hver vej, før derefter underarmene op ad væggen 8 gange med ribbenene nede." },
  mobPushSafe: { name: "Små armcirkler & wall slides", instruction: "Små, langsomme armcirkler uden smerte, derefter 6 rolige wall slides kun så højt, det føles godt." },
  mobPull: { name: "Kat-ko & rotationer i øvre ryg", instruction: "6 langsomme kat-ko på alle fire, derefter 6 rotationer i øvre ryg per side." },
  mobPullStanding: { name: "Stående rotationer", instruction: "Stå rank med armene over kors og drej øvre ryg roligt 8 gange per side med rolige hofter." },
  mobFull: { name: "Kat-ko, bensving & armcirkler", instruction: "5 langsomme kat-ko, 6 bensving med støtte per ben, derefter 8 armcirkler hver vej." },
  mobFullStanding: { name: "Stående mobilitet", instruction: "8 stående rotationer i øvre ryg per side, 6 bensving med støtte per ben, derefter små armcirkler." },
  actBridges: { name: "Hofteløft", instruction: "Lig på ryggen med fødderne i gulvet og løft hoften 10 gange. Pause og spænd i toppen." },
  actBridgesSquats: { name: "Hofteløft & squats", instruction: "10 hofteløft, derefter 8 langsomme squats med kropsvægt til en behagelig dybde, knæene i linje med tæerne." },
  actWallPush: { name: "Armstrækninger mod væg", instruction: "10 langsomme armstrækninger mod væggen, kroppen i én linje og skulderbladene frie." },
  actInclinePush: { name: "Skrå armstrækninger", instruction: "8 armstrækninger med hænderne på en stabil forhøjning. Stop 3–4 gentagelser før det bliver tungt." },
  actBandPullApart: { name: "Band pull-aparts", instruction: "Hold et let elastikbånd i skulderhøjde og træk det fra hinanden 15 gange, mens du samler skulderbladene." },
  actYtw: { name: "Y-T-W-løft på maven", instruction: "Lig på maven og løft armene i Y, T og W, 5 langsomme gentagelser hver. Intet udstyr." },
  actScapPull: { name: "Skulderbladstræk", instruction: "Hæng i stangen og træk skulderbladene ned og tilbage 8 gange uden at bøje albuerne." },
  actFullGentle: { name: "Hofteløft & armstrækninger mod væg", instruction: "10 hofteløft, derefter 10 langsomme armstrækninger mod væggen." },
  actFull: { name: "Hofteløft & skrå armstrækninger", instruction: "10 hofteløft, derefter 8 armstrækninger med hænderne på en stabil forhøjning." },
  rampLight: { name: "", instruction: "Opvarmningssæt 1: 8 lette gentagelser med cirka halvdelen af din arbejdsvægt. Fokuser på ren teknik." },
  rampHeavy: { name: "", instruction: "Opvarmningssæt 2: 3 hurtige gentagelser med cirka tre fjerdedele af din arbejdsvægt. Hvil derefter cirka et minut." },
  rehearsalLoad: { name: "", instruction: "Øvesæt: 8 jævne gentagelser med let vægt for at øve bevægelsen." },
  rehearsalFree: { name: "", instruction: "Øvesæt: 8 jævne gentagelser med meget let vægt eller en lettere variant af øvelsen." },
};

const swissGerman = Object.fromEntries(
  Object.entries(de).map(([key, entry]) => [
    key,
    {
      name: entry.name.replace(/ß/g, "ss"),
      instruction: entry.instruction.replace(/ß/g, "ss"),
    },
  ]),
) as Copy;

const COPY: Record<string, Copy> = {
  en,
  de,
  "de-CH": swissGerman,
  fr,
  es,
  it,
  nl,
  sv,
  no,
  da,
};

export function warmupCopy(locale: string): Copy {
  return COPY[locale] ?? en;
}
