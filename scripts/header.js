'use strict';
// The date-first header: weekday + big date, plus a live count of today's and
// tomorrow's events. RLS already hides events I'm not allowed to see, so a plain
// count over state.events is correct (private events I can't see aren't loaded).

function renderHeader(){
  const now = new Date();

  const wd = $('hdWeekday');
  if(wd) wd.textContent = capital(WEEKDAYS[now.getDay()]);

  const dt = $('hdDate');
  if(dt) dt.textContent = `${now.getDate()} ${capital(MONTHS_LONG[now.getMonth()])}`;

  const sub = $('hdSub');
  if(sub){
    const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
    const tKey = todayKey(), mKey = dateKey(tmr);
    const events = state.events || [];
    const today = events.filter(e => dateKey(e.starts_at) === tKey).length;
    const tomorrow = events.filter(e => dateKey(e.starts_at) === mKey).length;
    sub.innerHTML =
      `<b>${today}</b> ${today === 1 ? 'händelse' : 'händelser'} idag · <b>${tomorrow}</b> imorgon`;
  }
}
