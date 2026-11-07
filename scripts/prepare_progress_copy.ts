import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const file = path.join(root, 'backend/data/fitness_ui.en.json');
const english = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
const terms = new Set<string>([
  '4 weeks', '3 months', '1 year', '{count} recorded days', 'Recorded-day average',
  'Change in this period', 'In progress', 'Current target', 'Estimated range', 'Previous period',
]);

const extraKeys = ['No activity', 'h', 'bpm', 'kg·reps', 'Full-body strength', 'Exercises', 'Retry', 'Sets', 'Completed', 'All time'];
const extraCopy: Record<string, string[]> = {
  de: ['Keine Aktivität', 'Std.', 'Schläge/min', 'kg·Wdh.', 'Ganzkörperkraft', 'Übungen', 'Erneut versuchen', 'Sätze', 'Abgeschlossen', 'Gesamter Zeitraum'],
  fr: ['Aucune activité', 'h', 'bpm', 'kg·rép.', 'Renforcement du corps entier', 'Exercices', 'Réessayer', 'Séries', 'Terminé', 'Toute la période'],
  sv: ['Ingen aktivitet', 'tim', 'slag/min', 'kg·reps', 'Helkroppsstyrka', 'Övningar', 'Försök igen', 'Set', 'Slutfört', 'Hela perioden'],
  no: ['Ingen aktivitet', 't', 'slag/min', 'kg·reps', 'Helkroppsstyrke', 'Øvelser', 'Prøv igjen', 'Sett', 'Fullført', 'Hele perioden'],
  da: ['Ingen aktivitet', 't', 'slag/min', 'kg·reps', 'Helkropsstyrke', 'Øvelser', 'Prøv igen', 'Sæt', 'Fuldført', 'Hele perioden'],
  nl: ['Geen activiteit', 'u', 'slagen/min', 'kg·herh.', 'Krachttraining voor het hele lichaam', 'Oefeningen', 'Opnieuw proberen', 'Sets', 'Voltooid', 'Hele periode'],
  es: ['Sin actividad', 'h', 'lat/min', 'kg·rep.', 'Fuerza de cuerpo completo', 'Ejercicios', 'Reintentar', 'Series', 'Completado', 'Todo el periodo'],
  it: ['Nessuna attività', 'h', 'battiti/min', 'kg·rip.', 'Forza di tutto il corpo', 'Esercizi', 'Riprova', 'Serie', 'Completato', 'Tutto il periodo'],
};
extraKeys.forEach(key => terms.add(key));

const reviewedFile = path.join(root, 'backend/data/fitness_ui.reviewed.json');
const reviewed = JSON.parse(fs.readFileSync(reviewedFile, 'utf8'));
reviewed.it = {
  ...reviewed.it,
  Chest: 'Petto',
  Shoulders: 'Spalle',
  Core: 'Addome',
};
for (const [locale, values] of Object.entries(extraCopy)) {
  reviewed[locale] ??= {};
  extraKeys.forEach((key, index) => { reviewed[locale][key] = values[index]; });
}
const shortKeys = ['Change in this period', 'In progress', 'Current target', 'Estimated range', 'Previous period'];
const shortCopy: Record<string, string[]> = {
  de: ['Änderung im Zeitraum', 'In Bearbeitung', 'Aktuelles Ziel', 'Geschätzter Bereich', 'Vorheriger Zeitraum'],
  fr: ['Évolution sur la période', 'En cours', 'Objectif actuel', 'Plage estimée', 'Période précédente'],
  sv: ['Förändring under perioden', 'Pågår', 'Nuvarande mål', 'Uppskattat intervall', 'Föregående period'],
  no: ['Endring i perioden', 'Pågår', 'Gjeldende mål', 'Anslått intervall', 'Forrige periode'],
  da: ['Ændring i perioden', 'I gang', 'Nuværende mål', 'Anslået interval', 'Forrige periode'],
  nl: ['Verandering in deze periode', 'Bezig', 'Huidig doel', 'Geschat bereik', 'Vorige periode'],
  es: ['Cambio en este periodo', 'En curso', 'Objetivo actual', 'Rango estimado', 'Periodo anterior'],
  it: ['Variazione nel periodo', 'In corso', 'Obiettivo attuale', 'Intervallo stimato', 'Periodo precedente'],
};
const lastTrainedCopy: Record<string, string> = {
  de: 'Zuletzt trainiert', fr: 'Dernier entraînement', sv: 'Senast tränad', no: 'Sist trent',
  da: 'Sidst trænet', nl: 'Laatst getraind', es: 'Último entrenamiento', it: 'Ultimo allenamento',
};
const filterKeys = ['Custom range', 'Apply', 'Preview data', 'Real data'];
const filterCopy: Record<string, string[]> = {
  de: ['Eigener Zeitraum', 'Anwenden', 'Vorschaudaten', 'Echte Daten'],
  fr: ['Période personnalisée', 'Appliquer', 'Données de démo', 'Données réelles'],
  sv: ['Egen period', 'Tillämpa', 'Demodata', 'Egna data'],
  no: ['Egendefinert periode', 'Bruk', 'Demodata', 'Egne data'],
  da: ['Egen periode', 'Anvend', 'Demodata', 'Egne data'],
  nl: ['Aangepaste periode', 'Toepassen', 'Voorbeeldgegevens', 'Eigen gegevens'],
  es: ['Periodo personalizado', 'Aplicar', 'Datos de ejemplo', 'Datos reales'],
  it: ['Periodo personalizzato', 'Applica', 'Dati di esempio', 'Dati reali'],
};
const graphKeys = [
  'Latest reading', 'Selected reading', 'Weekly total', 'Lowest', 'Highest',
  'First reading', 'Change', 'Edge weeks include only the selected dates.', 'Body & recovery',
];
const graphCopy: Record<string, string[]> = {
  de: ['Letzter Wert', 'Ausgewählter Wert', 'Wochensumme', 'Niedrigster Wert', 'Höchster Wert', 'Erster Wert', 'Änderung', 'Randwochen zeigen nur die gewählten Tage.', 'Körper & Erholung'],
  fr: ['Dernière mesure', 'Mesure sélectionnée', 'Total hebdomadaire', 'Minimum', 'Maximum', 'Première mesure', 'Évolution', 'Les semaines aux extrémités incluent uniquement les dates choisies.', 'Corps et récupération'],
  sv: ['Senaste värdet', 'Valt värde', 'Veckototal', 'Lägsta', 'Högsta', 'Första värdet', 'Förändring', 'Första och sista veckan visar bara valda datum.', 'Kropp och återhämtning'],
  no: ['Siste verdi', 'Valgt verdi', 'Ukesum', 'Laveste', 'Høyeste', 'Første verdi', 'Endring', 'Første og siste uke viser bare valgte datoer.', 'Kropp og restitusjon'],
  da: ['Seneste værdi', 'Valgt værdi', 'Ugetotal', 'Laveste', 'Højeste', 'Første værdi', 'Ændring', 'Første og sidste uge viser kun valgte datoer.', 'Krop og restitution'],
  nl: ['Laatste meting', 'Geselecteerde meting', 'Weektotaal', 'Laagste', 'Hoogste', 'Eerste meting', 'Verandering', 'De eerste en laatste week tonen alleen gekozen datums.', 'Lichaam en herstel'],
  es: ['Última lectura', 'Lectura seleccionada', 'Total semanal', 'Mínimo', 'Máximo', 'Primera lectura', 'Cambio', 'Las semanas de los extremos solo incluyen las fechas elegidas.', 'Cuerpo y recuperación'],
  it: ['Ultima lettura', 'Lettura selezionata', 'Totale settimanale', 'Minimo', 'Massimo', 'Prima lettura', 'Variazione', 'Le settimane ai margini includono solo le date scelte.', 'Corpo e recupero'],
};
graphKeys.forEach(key => terms.add(key));
filterKeys.forEach(key => terms.add(key));
terms.add('Last trained');
for (const [locale, values] of Object.entries(shortCopy)) {
  reviewed[locale] ??= {};
  reviewed[locale]['Last trained'] = lastTrainedCopy[locale];
  filterKeys.forEach((key, index) => { reviewed[locale][key] = filterCopy[locale]![index]; });
  graphKeys.forEach((key, index) => { reviewed[locale][key] = graphCopy[locale]![index]; });
  shortKeys.forEach((key, index) => { reviewed[locale][key] = values[index]; });
}
fs.writeFileSync(reviewedFile, JSON.stringify(reviewed, null, 2));

function visit(directory: string) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(location);
    } else if (entry.name.endsWith('.dart')) {
      const source = fs.readFileSync(location, 'utf8');
      for (const match of source.matchAll(/'([^'\n]+)'/g)) {
        const value = match[1]!;
        if (/^[A-Z]/.test(value) && !/[$/:_\\]/.test(value) && value.length > 2) terms.add(value);
      }
      for (const match of source.matchAll(/fitnessText\(\s*context,\s*'([^'\n]+)'/g)) {
        if (/^[A-Z]/.test(match[1]!)) terms.add(match[1]!);
      }
    }
  }
}

visit(path.join(root, 'mobile/lib/features/progress'));
const missing = [...terms].filter(term => !(term in english));
for (const term of missing) english[term] = term;
fs.writeFileSync(file, JSON.stringify(english, null, 2));
console.log(`Prepared ${missing.length} new Progress labels for supported languages.`);
