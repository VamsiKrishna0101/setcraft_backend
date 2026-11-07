const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const locales = ['de', 'fr', 'sv', 'no', 'da', 'nl', 'es', 'it'];
const rows = [
['Custom meal','Eigene Mahlzeit','Repas personnel','Egen måltid','Eget måltid','Eget måltid','Eigen maaltijd','Comida propia','Pasto personale'],
['Food type','Lebensmittelart','Type d’aliment','Livsmedelstyp','Matvaretype','Fødevaretype','Voedseltype','Tipo de alimento','Tipo di alimento'],
['Nutrition focus','Nährstofffokus','Priorité nutritionnelle','Näringsfokus','Ernæringsfokus','Ernæringsfokus','Voedingsfocus','Enfoque nutricional','Obiettivo nutrizionale'],
['All foods','Alle Lebensmittel','Tous les aliments','Alla livsmedel','Alle matvarer','Alle fødevarer','Alle voedingsmiddelen','Todos los alimentos','Tutti gli alimenti'],
['Any nutrition','Alle Nährwerte','Sans priorité','Alla näringsvärden','Alle næringsverdier','Alle næringsværdier','Alle voedingswaarden','Sin preferencia','Senza preferenze'],
['Higher protein','Mehr Protein','Plus de protéines','Mer protein','Mer protein','Mere protein','Meer eiwit','Más proteína','Più proteine'],
['More fibre','Mehr Ballaststoffe','Plus de fibres','Mer fibrer','Mer fiber','Flere fibre','Meer vezels','Más fibra','Più fibre'],
['Lighter foods','Weniger Kalorien','Moins de calories','Färre kalorier','Færre kalorier','Færre kalorier','Minder calorieën','Menos calorías','Meno calorie'],
['My foods','Meine Lebensmittel','Mes aliments','Mina livsmedel','Mine matvarer','Mine fødevarer','Mijn voedingsmiddelen','Mis alimentos','I miei alimenti'],
['Browse','Auswahl','Parcourir','Bläddra','Bla gjennom','Gennemse','Bladeren','Explorar','Esplora'],
['Sort by','Sortieren nach','Trier par','Sortera efter','Sorter etter','Sortér efter','Sorteren op','Ordenar por','Ordina per'],
['Name A–Z','Name A–Z','Nom A–Z','Namn A–Ö','Navn A–Å','Navn A–Å','Naam A–Z','Nombre A–Z','Nome A–Z'],
['Most protein','Meistes Protein','Plus de protéines','Mest protein','Mest protein','Mest protein','Meeste eiwit','Más proteína','Più proteine'],
['Fewest calories','Wenigste Kalorien','Moins de calories','Minst kalorier','Færrest kalorier','Færrest kalorier','Minste calorieën','Menos calorías','Meno calorie'],
['Page {page} of {pages}','Seite {page} von {pages}','Page {page} sur {pages}','Sida {page} av {pages}','Side {page} av {pages}','Side {page} af {pages}','Pagina {page} van {pages}','Página {page} de {pages}','Pagina {page} di {pages}'],
['24 foods per page','24 Lebensmittel pro Seite','24 aliments par page','24 livsmedel per sida','24 matvarer per side','24 fødevarer pr. side','24 voedingsmiddelen per pagina','24 alimentos por página','24 alimenti per pagina'],
['{count} foods','{count} Lebensmittel','{count} aliments','{count} livsmedel','{count} matvarer','{count} fødevarer','{count} voedingsmiddelen','{count} alimentos','{count} alimenti'],
['{amount} g protein','{amount} g Protein','{amount} g de protéines','{amount} g protein','{amount} g protein','{amount} g protein','{amount} g eiwit','{amount} g de proteína','{amount} g di proteine'],
['Good food.\nYour way.','Gut essen.\nAuf deine Art.','Bien manger.\nÀ votre façon.','God mat.\nPå ditt sätt.','God mat.\nPå din måte.','God mad.\nPå din måde.','Goed eten.\nOp jouw manier.','Come bien.\nA tu manera.','Mangia bene.\nA modo tuo.'],
['Find a food, choose your portion, log it.','Lebensmittel finden, Portion wählen, eintragen.','Choisissez un aliment, une portion et enregistrez.','Hitta mat, välj portion och registrera.','Finn mat, velg porsjon og registrer.','Find mad, vælg portion og registrér.','Vind eten, kies je portie en registreer.','Busca un alimento, elige tu porción y regístrala.','Trova un alimento, scegli la porzione e registrala.'],
['No foods found','Keine Lebensmittel gefunden','Aucun aliment trouvé','Inga livsmedel hittades','Ingen matvarer funnet','Ingen fødevarer fundet','Geen voedingsmiddelen gevonden','No se encontraron alimentos','Nessun alimento trovato'],
['Clear filters','Filter zurücksetzen','Effacer les filtres','Rensa filter','Fjern filtre','Ryd filtre','Filters wissen','Borrar filtros','Cancella filtri'],
['Your portion','Deine Portion','Votre portion','Din portion','Din porsjon','Din portion','Jouw portie','Tu porción','La tua porzione'],
['Amount eaten','Verzehrte Menge','Quantité consommée','Äten mängd','Spist mengde','Spist mængde','Gegeten hoeveelheid','Cantidad consumida','Quantità consumata'],
['Meal','Mahlzeit','Repas','Måltid','Måltid','Måltid','Maaltijd','Comida','Pasto'],
['Make it yours','Nach deinem Geschmack','À votre goût','På ditt sätt','På din måte','På din måde','Naar jouw smaak','A tu gusto','A modo tuo'],
['Your eating style, allergies and foods you avoid.','Deine Ernährungsweise, Allergien und Lebensmittel, die du meidest.','Votre alimentation, vos allergies et les aliments à éviter.','Din kost, allergier och mat du undviker.','Kosthold, allergier og mat du unngår.','Din kost, allergier og mad, du undgår.','Je eetpatroon, allergieën en voedingsmiddelen die je vermijdt.','Tu alimentación, alergias y alimentos que evitas.','Alimentazione, allergie e alimenti che eviti.'],
['Eating style','Ernährungsweise','Style alimentaire','Kosthållning','Kosthold','Kosttype','Eetpatroon','Tipo de alimentación','Stile alimentare'],
['Your eating style','Deine Ernährungsweise','Votre style alimentaire','Din kosthållning','Ditt kosthold','Din kosttype','Jouw eetpatroon','Tu tipo de alimentación','Il tuo stile alimentare'],
['Separate foods with commas.','Lebensmittel durch Kommas trennen.','Séparez les aliments par des virgules.','Separera livsmedel med kommatecken.','Skill matvarer med komma.','Adskil fødevarer med kommaer.','Scheid voedingsmiddelen met komma’s.','Separa los alimentos con comas.','Separa gli alimenti con virgole.'],
['Foods you avoid','Lebensmittel, die du meidest','Aliments à éviter','Mat du undviker','Mat du unngår','Mad, du undgår','Voedingsmiddelen die je vermijdt','Alimentos que evitas','Alimenti che eviti'],
['Protein foods','Proteinreiche Lebensmittel','Sources de protéines','Proteinkällor','Proteinkilder','Proteinkilder','Eiwitbronnen','Fuentes de proteína','Fonti di proteine'],
['Grains & carbs','Getreide & Kohlenhydrate','Céréales et glucides','Spannmål och kolhydrater','Korn og karbohydrater','Korn og kulhydrater','Granen en koolhydraten','Cereales y carbohidratos','Cereali e carboidrati'],
['Fats & oils','Fette & Öle','Matières grasses et huiles','Fetter och oljor','Fett og oljer','Fedt og olier','Vetten en oliën','Grasas y aceites','Grassi e oli'],
['Prepared meals','Zubereitete Gerichte','Plats préparés','Tillagade rätter','Tilberedte retter','Tilberedte retter','Bereide maaltijden','Platos preparados','Piatti pronti'],
['Other foods','Andere Lebensmittel','Autres aliments','Andra livsmedel','Andre matvarer','Andre fødevarer','Andere voedingsmiddelen','Otros alimentos','Altri alimenti'],
['At least 15 g protein per 100 g.','Mindestens 15 g Protein pro 100 g.','Au moins 15 g de protéines pour 100 g.','Minst 15 g protein per 100 g.','Minst 15 g protein per 100 g.','Mindst 15 g protein pr. 100 g.','Minstens 15 g eiwit per 100 g.','Al menos 15 g de proteína por 100 g.','Almeno 15 g di proteine per 100 g.'],
['At least 3 g fibre per 100 g.','Mindestens 3 g Ballaststoffe pro 100 g.','Au moins 3 g de fibres pour 100 g.','Minst 3 g fibrer per 100 g.','Minst 3 g fiber per 100 g.','Mindst 3 g fibre pr. 100 g.','Minstens 3 g vezels per 100 g.','Al menos 3 g de fibra por 100 g.','Almeno 3 g di fibre per 100 g.'],
['Up to 100 kcal per 100 g.','Bis zu 100 kcal pro 100 g.','Jusqu’à 100 kcal pour 100 g.','Högst 100 kcal per 100 g.','Opptil 100 kcal per 100 g.','Op til 100 kcal pr. 100 g.','Tot 100 kcal per 100 g.','Hasta 100 kcal por 100 g.','Fino a 100 kcal per 100 g.'],
['Preferences are saved to your profile. This library has nutrition values, but no verified ingredient or allergen labels. Check the actual label before choosing a food.',
'Vorlieben werden in deinem Profil gespeichert. Diese Sammlung enthält Nährwerte, aber keine geprüften Zutaten- oder Allergenangaben. Prüfe das tatsächliche Etikett, bevor du ein Lebensmittel wählst.',
'Vos préférences sont enregistrées dans votre profil. La bibliothèque fournit des valeurs nutritionnelles, mais aucune liste vérifiée d’ingrédients ou d’allergènes. Vérifiez l’étiquette réelle avant de choisir un aliment.',
'Dina preferenser sparas i din profil. Biblioteket har näringsvärden men inga verifierade ingrediens- eller allergenlistor. Kontrollera den faktiska etiketten innan du väljer mat.',
'Preferansene lagres i profilen din. Biblioteket har næringsverdier, men ingen bekreftede ingrediens- eller allergenlister. Sjekk den faktiske etiketten før du velger mat.',
'Dine præferencer gemmes i din profil. Biblioteket har næringsværdier, men ingen verificerede ingrediens- eller allergenlister. Tjek den faktiske etiket, før du vælger mad.',
'Je voorkeuren worden in je profiel opgeslagen. De bibliotheek bevat voedingswaarden, maar geen gecontroleerde ingrediënten- of allergenenlijsten. Controleer het echte etiket voordat je eten kiest.',
'Tus preferencias se guardan en tu perfil. La biblioteca tiene valores nutricionales, pero no listas verificadas de ingredientes o alérgenos. Comprueba la etiqueta real antes de elegir un alimento.',
'Le preferenze vengono salvate nel profilo. La biblioteca contiene valori nutrizionali, ma non elenchi verificati di ingredienti o allergeni. Controlla l’etichetta reale prima di scegliere un alimento.'],
];
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'data', name), 'utf8'));
const english = read('fitness_ui.en.json'), reviewed = read('fitness_ui.reviewed.json'), data = read('fitness_ui.json');
for (const row of rows) {
  if (row.length !== locales.length + 1) throw new Error('Incomplete translation row');
  english[row[0]] = row[0]; data.en[row[0]] = row[0];
  locales.forEach((locale, index) => { reviewed[locale] ??= {}; data[locale] ??= {};
    reviewed[locale][row[0]] = row[index + 1]; data[locale][row[0]] = row[index + 1]; });
}
for (const [name, value] of [['fitness_ui.en.json', english], ['fitness_ui.reviewed.json', reviewed], ['fitness_ui.json', data]])
  fs.writeFileSync(path.join(root, 'data', name), JSON.stringify(value, null, 2));
fs.writeFileSync(path.join(root, '../mobile/lib/core/localization/fitness_copy_data.dart'),
  '// Generated by backend/scripts/prepare_fitness_copy.ts.\nconst fitnessCopyData = <String, Map<String, String>>' + JSON.stringify(data, null, 2).replace(/\$/g, '\\$') + ';\n');
console.log(`Published ${rows.length} food-library terms in nine languages.`);
