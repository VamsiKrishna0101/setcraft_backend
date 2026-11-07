const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const locales = ['de', 'fr', 'sv', 'no', 'da', 'nl', 'es', 'it'];
const rows = [
['Health data synced','Gesundheitsdaten synchronisiert','Données de santé synchronisées','Hälsodata synkroniserade','Helsedata synkronisert','Sundhedsdata synkroniseret','Gezondheidsgegevens gesynchroniseerd','Datos de salud sincronizados','Dati salute sincronizzati'],
['No readiness for this day','Keine Bereitschaft für diesen Tag','Pas de score de préparation ce jour','Ingen beredskap för den här dagen','Ingen beredskap for denne dagen','Ingen parathed for denne dag','Geen gereedheid voor deze dag','Sin preparación para este día','Nessun punteggio per questo giorno'],
['No synced sleep or heart readings for this day.','Für diesen Tag fehlen synchronisierte Schlaf- und Herzmesswerte.','Aucune donnée de sommeil ou cardiaque synchronisée ce jour.','Inga synkroniserade sömn- eller hjärtvärden för den här dagen.','Ingen synkroniserte søvn- eller hjertemålinger for denne dagen.','Ingen synkroniserede søvn- eller hjertemålinger for denne dag.','Geen gesynchroniseerde slaap- of hartmetingen voor deze dag.','No hay datos de sueño ni cardíacos sincronizados para este día.','Nessun dato di sonno o cardiaco sincronizzato per questo giorno.'],
['Steps can sync without sleep or heart readings. Both are still missing for this day.','Schritte können ohne Schlaf- oder Herzmesswerte synchronisiert werden. Beide fehlen noch für diesen Tag.','Les pas peuvent être synchronisés sans données de sommeil ou cardiaques. Les deux manquent encore pour ce jour.','Steg kan synkroniseras utan sömn- eller hjärtvärden. Båda saknas fortfarande för den här dagen.','Skritt kan synkroniseres uten søvn- eller hjertemålinger. Begge mangler fortsatt for denne dagen.','Skridt kan synkroniseres uden søvn- eller hjertemålinger. Begge mangler stadig for denne dag.','Stappen kunnen zonder slaap- of hartmetingen synchroniseren. Beide ontbreken nog voor deze dag.','Los pasos pueden sincronizarse sin datos de sueño o cardíacos. Ambos faltan todavía para este día.','I passi possono sincronizzarsi senza dati di sonno o cardiaci. Entrambi mancano ancora per questo giorno.'],
['Heart data synced. Sleep is still missing for this day.','Herzdaten synchronisiert. Schlafdaten fehlen noch für diesen Tag.','Données cardiaques synchronisées. Le sommeil manque encore pour ce jour.','Hjärtdata synkroniserade. Sömn saknas fortfarande för den här dagen.','Hjertedata synkronisert. Søvn mangler fortsatt for denne dagen.','Hjertedata synkroniseret. Søvn mangler stadig for denne dag.','Hartgegevens gesynchroniseerd. Slaap ontbreekt nog voor deze dag.','Datos cardíacos sincronizados. Falta el sueño de este día.','Dati cardiaci sincronizzati. Manca ancora il sonno per questo giorno.'],
['Sleep synced. A resting heart rate or HRV reading is still missing.','Schlaf synchronisiert. Ruhepuls oder HRV fehlen noch.','Sommeil synchronisé. Il manque encore une fréquence cardiaque au repos ou une mesure de VFC.','Sömn synkroniserad. Vilopuls eller HRV saknas fortfarande.','Søvn synkronisert. Hvilepuls eller HRV mangler fortsatt.','Søvn synkroniseret. Hvilepuls eller HRV mangler stadig.','Slaap gesynchroniseerd. Rusthartslag of HRV ontbreekt nog.','Sueño sincronizado. Falta una lectura de frecuencia cardíaca en reposo o VFC.','Sonno sincronizzato. Manca ancora la frequenza cardiaca a riposo o la variabilità cardiaca.'],
['Sleep and heart readings are available. Refresh to update readiness.','Schlaf- und Herzmesswerte sind vorhanden. Aktualisiere, um die Bereitschaft neu zu laden.','Les données de sommeil et cardiaques sont disponibles. Actualisez pour mettre à jour le score.','Sömn- och hjärtvärden finns. Uppdatera för att hämta beredskapen.','Søvn- og hjertemålinger er tilgjengelige. Oppdater for å hente beredskap.','Søvn- og hjertemålinger er tilgængelige. Opdatér for at hente parathed.','Slaap- en hartmetingen zijn beschikbaar. Vernieuw om de gereedheid bij te werken.','Hay datos de sueño y cardíacos. Actualiza para ver la preparación.','I dati di sonno e cardiaci sono disponibili. Aggiorna per vedere il punteggio.'],
['Synced sleep','Synchronisierter Schlaf','Sommeil synchronisé','Synkroniserad sömn','Synkronisert søvn','Synkroniseret søvn','Gesynchroniseerde slaap','Sueño sincronizado','Sonno sincronizzato'],
['Resting heart rate or HRV','Ruhepuls oder HRV','Fréquence au repos ou VFC','Vilopuls eller HRV','Hvilepuls eller HRV','Hvilepuls eller HRV','Rusthartslag of HRV','Frecuencia en reposo o VFC','Frequenza a riposo o variabilità cardiaca'],
['Recorded','Aufgezeichnet','Enregistré','Registrerat','Registrert','Registreret','Geregistreerd','Registrado','Registrato'],
['Missing','Fehlt','Manquant','Saknas','Mangler','Mangler','Ontbreekt','Falta','Mancante'],
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
console.log(`Published ${rows.length} readiness terms in nine languages.`);
