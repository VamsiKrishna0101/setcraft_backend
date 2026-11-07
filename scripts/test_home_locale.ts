import assert from 'node:assert/strict';
import { localizedHomeData } from '../modules/home/home_locale';
import { APP_LANGUAGES, contentLocale } from '../utils/app_locale';
import { fitnessTerm } from '../utils/fitness_locale';
const note='Target Effort: 8.5/10 — Adjust the planned effort to how you feel today.';
const source={user:{name:'Synthetic member',streakDays:2},
  readiness:{score:8.4,label:'Optimal Recovery',aiTarget:'',source:'manual',hrvMs:68,date:'2026-10-07'},
  todayWorkout:{userWorkoutId:'synthetic-plan',weekLabel:'2026-W41',workoutTitle:'Dumbbell press',
    workoutTitleByLang:{en:'Dumbbell press',fr:'Développé avec haltères',de:'Kurzhantel-Bankdrücken'},
    sessionTitle:'Full-body strength',category:'Strength',exerciseCount:6,durationMinutes:48,status:'NOT_STARTED',aiNote:note},
  nutrition:{calories:{consumed:1200,target:2400}},weeklyStreak:[]};
async function main() {
    for(const language of APP_LANGUAGES) {
      const response:any=await localizedHomeData(source as any,language,'synthetic');
      assert.equal(response.readiness.score,8.4);
      assert.equal(response.readiness.label,fitnessTerm('Optimal Recovery',language));
      assert.equal(response.todayWorkout.sessionTitle,fitnessTerm('Full-body strength',language));
      assert.equal(response.todayWorkout.aiNote,fitnessTerm(note,language));
      assert.equal(response.todayWorkout.workoutTitleByLang,undefined);
      if(['fr','de','de-CH'].includes(language)) assert.equal(response.todayWorkout.workoutTitle,(source.todayWorkout.workoutTitleByLang as any)[contentLocale(language)]);
      assert.deepEqual(response.nutrition,source.nutrition);
      assert.equal(source.readiness.label,'Optimal Recovery');
    }
    console.log('Home locale presentation passed for all 10 app choices. Canonical cache and numbers unchanged.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
