import { HomeData } from './home_types';
import { contentLocale } from '../../utils/app_locale';
import { fitnessTerm, localizedCoaching } from '../../utils/fitness_locale';

// Present a localized copy without changing the canonical home cache or metrics.
export async function localizedHomeData(data:HomeData,locale:string,userId:string) {
  const [aiTarget, aiNote] = await Promise.all([
    localizedCoaching(data.readiness?.aiTarget,locale,userId),
    localizedCoaching(data.todayWorkout?.aiNote,locale,userId),
  ]);
  let sessionTitle=data.todayWorkout?.sessionTitle;
  if(sessionTitle) {
    const direct=fitnessTerm(sessionTitle,locale);
    sessionTitle=direct!==sessionTitle?direct:sessionTitle.endsWith(' session')
      ? fitnessTerm('{category} session',locale).replace('{category}',fitnessTerm(sessionTitle.slice(0,-8),locale)) : sessionTitle;
  }
  return {...data,
    readiness:data.readiness?{...data.readiness,label:fitnessTerm(data.readiness.label,locale),aiTarget:aiTarget||''}:null,
    todayWorkout:data.todayWorkout?{...data.todayWorkout,workoutTitleByLang:undefined,
      workoutTitle:data.todayWorkout.workoutTitleByLang?.[contentLocale(locale)]||data.todayWorkout.workoutTitle,
      sessionTitle,aiNote}:null};
}
