'use strict';
// Bundled fixtures for the read-only showcase — entered via the "Utforska en demo" button on the
// login screen (no account needed). These load straight
// into `state`; the demo never authenticates, so it can neither read nor write the real
// database (anon requests are denied by RLS). Dates are computed relative to "now" so the
// calendar and matsedel always look current. The family here is fictional.

const DEMO_DATA = (function(){
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const at   = (d, h = 0, m = 0) => { const x = new Date(now); x.setDate(now.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  const day  = (d) => { const x = new Date(now); x.setDate(now.getDate() + d); return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`; };
  const week = (i) => { const x = new Date(now); x.setDate(now.getDate() - ((now.getDay()+6)%7) + i); return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`; };
  const month = (o) => { const x = new Date(now.getFullYear(), now.getMonth() + o, 1); return `${x.getFullYear()}-${pad(x.getMonth()+1)}`; };
  const grp = (name, children) => ({ name, collapsed:false, children });   // budget group (matches the app's model)

  const P = { johan:'demo-johan', anna:'demo-anna', nils:'demo-nils', ella:'demo-ella' };

  const profiles = [
    { id:P.johan, name:'johan', role:'parent', color:'#c98aa8' },
    { id:P.anna,  name:'anna',  role:'parent', color:'#5b8def' },
    { id:P.nils,  name:'nils',  role:'kid',    color:'#7ea065' },
    { id:P.ella,  name:'ella',  role:'kid',    color:'#d79b4e' }
  ];

  const events = [
    { id:'ev-danmark', title:'Åka till Danmark', starts_at:at(0,8,0), ends_at:at(0,20,0), all_day:false, owner_id:null,     category:'familj',    private:false, notes:'Ta med passen!', created_by:P.johan, created_at:at(-5) },
    { id:'ev-paket',   title:'Hämta paket + Granngården', starts_at:at(0,15,0), ends_at:null, all_day:false, owner_id:P.johan, category:'annat', private:false, notes:null, created_by:P.johan, created_at:at(-2) },
    { id:'ev-vet',     title:'Ring veterinär', starts_at:at(1,9,0), ends_at:null, all_day:false, owner_id:P.anna, category:'halsa', private:false, notes:'Boka tid för stygnborttagning', created_by:P.anna, created_at:at(-1) },
    { id:'ev-tand',    title:'Tandläkare', starts_at:at(1,14,40), ends_at:at(1,15,30), all_day:false, owner_id:P.nils, category:'halsa', private:false, notes:'Tandläkarundersökning i Ljungby', created_by:P.anna, created_at:at(-1) },
    { id:'ev-fotboll', title:'Fotbollsträning', starts_at:at(2,17,0), ends_at:at(2,18,30), all_day:false, owner_id:P.nils, category:'aktivitet', private:false, notes:null, created_by:P.johan, created_at:at(-3) },
    { id:'ev-simskola',title:'Simskola', starts_at:at(3,16,0), ends_at:at(3,17,0), all_day:false, owner_id:P.ella, category:'aktivitet', private:false, notes:null, created_by:P.anna, created_at:at(-3) },
    { id:'ev-kalas',   title:'Kalas hos Emma', starts_at:at(5,13,0), ends_at:at(5,16,0), all_day:false, owner_id:P.ella, category:'kalas', private:false, notes:'Present: pysselset', created_by:P.anna, created_at:at(-2) },
    { id:'ev-lov',     title:'Sommarlov börjar', starts_at:at(6,0,0), ends_at:null, all_day:true, owner_id:null, category:'skola', private:false, notes:null, created_by:P.johan, created_at:at(-4) }
  ];

  const tasks = [
    { id:'t-diska',  title:'Diska', description:'Efter middagen', reward:15, status:'open',      claimed_by:null,   created_by:P.johan, reject_reason:null, created_at:at(-1) },
    { id:'t-sopor',  title:'Ta ut soporna', description:null, reward:10, status:'open',           claimed_by:null,   created_by:P.johan, reject_reason:null, created_at:at(-1) },
    { id:'t-dammsug',title:'Dammsuga vardagsrummet', description:null, reward:20, status:'claimed',claimed_by:P.nils, created_by:P.anna, reject_reason:null, created_at:at(-2) },
    { id:'t-ogras',  title:'Rensa ogräs i rabatten', description:'Hela framsidan', reward:30, status:'submitted', claimed_by:P.ella, created_by:P.johan, reject_reason:null, created_at:at(-3) }
  ];

  const templates = [
    { id:'tpl-badda', title:'Bädda sängen', description:null, reward:5 },
    { id:'tpl-tvatt', title:'Vika tvätt', description:null, reward:15 }
  ];

  const balances = [ { profile_id:P.nils, balance:145 }, { profile_id:P.ella, balance:90 } ];
  const ledger = [
    { id:'l1', profile_id:P.nils, amount:20,  reason:'Godkänt: Dammsuga',    created_at:at(-2) },
    { id:'l2', profile_id:P.ella, amount:15,  reason:'Godkänt: Diska',       created_at:at(-4) },
    { id:'l3', profile_id:P.nils, amount:-50, reason:'Utbetalt',             created_at:at(-6) },
    { id:'l4', profile_id:P.ella, amount:25,  reason:'Godkänt: Rensa ogräs', created_at:at(-7) }
  ];
  const payouts = [ { id:'po1', profile_id:P.nils, amount:100, status:'pending', created_at:at(-1) } ];

  const suggestions = [
    { id:'sg-liseberg', title:'Åka till Liseberg', notes:'Innan skolan börjar', created_by:P.ella, created_at:at(-3) },
    { id:'sg-film',     title:'Filmkväll på fredag', notes:'Popcorn och pizza',  created_by:P.nils, created_at:at(-2) },
    { id:'sg-grilla',   title:'Grilla i parken',   notes:null,                   created_by:P.anna, created_at:at(-1) }
  ];
  const votes = [
    { id:'vt1', suggestion_id:'sg-liseberg', profile_id:P.nils,  vote:1 },
    { id:'vt2', suggestion_id:'sg-liseberg', profile_id:P.johan, vote:1 },
    { id:'vt3', suggestion_id:'sg-liseberg', profile_id:P.ella,  vote:1 },
    { id:'vt4', suggestion_id:'sg-film',     profile_id:P.ella,  vote:1 },
    { id:'vt5', suggestion_id:'sg-film',     profile_id:P.anna,  vote:-1 },
    { id:'vt6', suggestion_id:'sg-grilla',   profile_id:P.nils,  vote:1 }
  ];

  const messages = [
    { id:'m1', context:'event', parent_id:'ev-danmark', author_id:P.johan, body:'Bokade färjan till 08:00.', image_path:null, created_at:at(-1,20,0) },
    { id:'m2', context:'event', parent_id:'ev-danmark', author_id:P.anna,  body:'Kom ihåg passen och lite dansk valuta!', image_path:null, created_at:at(0,7,30) },
    { id:'m3', context:'task',  parent_id:'t-ogras',    author_id:P.ella,  body:'Klart nu, får jag godkänt?', image_path:null, created_at:at(0,9,0) },
    { id:'m4', context:'shopping', parent_id:'st-klader-nils', author_id:P.anna, body:'Vilken skostorlek har du nu?', image_path:null, created_at:at(-1,18,0) },
    { id:'m5', context:'shopping', parent_id:'st-klader-nils', author_id:P.nils, body:'38 känns lite små, testa 39.', image_path:null, created_at:at(-1,18,25) }
  ];

  const todos = [
    { id:'td1', title:'Handla mjölk och bröd', done:false, private:false, owner_id:null,     created_by:P.anna,  created_at:at(-1), done_at:null,   done_by:null },
    { id:'td2', title:'Boka bilservice',       done:false, private:false, owner_id:null,     created_by:P.johan, created_at:at(-2), done_at:null,   done_by:null },
    { id:'td3', title:'Vattna blommorna',      done:true,  private:false, owner_id:null,     created_by:P.nils,  created_at:at(-3), done_at:at(-1), done_by:P.nils },
    { id:'td4', title:'Ringa mamma',           done:false, private:true,  owner_id:P.johan,  created_by:P.johan, created_at:at(-1), done_at:null,   done_by:null }
  ];

  const meals = [
    { id:'me1', date:week(0), title:'Tacos', note:null, created_by:P.johan },
    { id:'me2', date:week(1), title:'Pasta bolognese', note:null, created_by:P.johan },
    { id:'me3', date:week(2), title:'Fläskfilé', note:'med klyftpotatis', created_by:P.anna },
    { id:'me4', date:week(3), title:'Fisk och potatis', note:null, created_by:P.anna },
    { id:'me5', date:week(4), title:'Hemmagjord pizza', note:null, created_by:P.johan },
    { id:'me6', date:week(6), title:'Söndagsstek', note:null, created_by:P.anna }
  ];
  const mealDishes = ['Tacos','Pasta bolognese','Fläskfilé','Fisk och potatis','Söndagsstek','Hemmagjord pizza','Korv stroganoff','Köttbullar']
    .map((t, i) => ({ id:'dish'+i, title:t }));
  const mealWishes = [
    { id:'w1', title:'Lasagne',    created_by:P.nils, created_at:at(-1) },
    { id:'w2', title:'Hamburgare', created_by:P.ella, created_at:at(-2) }
  ];

  const shopTopics = [
    { id:'st-klader-nils', title:'Kläder',    emoji:'👕', owner_id:P.nils, created_by:P.anna,  created_at:at(-7) },
    { id:'st-klader-ella', title:'Kläder',    emoji:'👕', owner_id:P.ella, created_by:P.anna,  created_at:at(-6) },
    { id:'st-skola-nils',  title:'Skolsaker', emoji:'🎒', owner_id:P.nils, created_by:P.johan, created_at:at(-5) },
    { id:'st-hem',         title:'Hemmet',    emoji:'🏠', owner_id:null,   created_by:P.anna,  created_at:at(-4) }
  ];
  const shopItems = [
    { id:'si1', topic_id:'st-klader-nils', title:'Strumpor',             bought:false, created_by:P.nils,  created_at:at(-3), bought_at:null,  bought_by:null },
    { id:'si2', topic_id:'st-klader-ella', title:'Vinterjacka',          bought:false, created_by:P.ella,  created_at:at(-2), bought_at:null,  bought_by:null },
    { id:'si3', topic_id:'st-klader-nils', title:'Regnbyxor',            bought:true,  created_by:P.anna,  created_at:at(-6), bought_at:at(-1), bought_by:P.anna },
    { id:'si4', topic_id:'st-skola-nils',  title:'Suddgummi',            bought:false, created_by:P.nils,  created_at:at(-2), bought_at:null,  bought_by:null },
    { id:'si5', topic_id:'st-skola-nils',  title:'Linjal och passare',   bought:false, created_by:P.nils,  created_at:at(-1), bought_at:null,  bought_by:null },
    { id:'si6', topic_id:'st-hem',         title:'Diskmedel',            bought:false, created_by:P.johan, created_at:at(-1), bought_at:null,  bought_by:null },
    { id:'si7', topic_id:'st-hem',         title:'Glödlampa till hallen',bought:false, created_by:P.anna,  created_at:at(-2), bought_at:null,  bought_by:null }
  ];

  // Rutiner: the behaviour library, the streck (marks) already earned, and a couple of pending
  // "I did this routine" requests for the parent's approval queue.
  const behaviors = [
    { id:'bh-badda',   title:'Bädda sängen',                    marks:2,  kind:'routine', needs_approval:true, active:true },
    { id:'bh-tallrik', title:'Ställa in tallriken',            marks:1,  kind:'routine', needs_approval:true, active:true },
    { id:'bh-laxa',    title:'Läxa i tid',                      marks:5,  kind:'routine', needs_approval:true, active:true },
    { id:'bh-tander',  title:'Borsta tänderna',                 marks:2,  kind:'routine', needs_approval:true, active:true },
    { id:'bh-brak',    title:'Inget syskonbråk hela dagen',     marks:20, kind:'bonus',   needs_approval:true, active:true },
    { id:'bh-hjalp',   title:'Hjälpa till utan att bli tillsagd', marks:10, kind:'bonus', needs_approval:true, active:true }
  ];
  const markLedger = [
    { id:'mk1', profile_id:P.nils, amount:20, reason:'Inget syskonbråk hela dagen',        behavior_id:'bh-brak',    created_at:at(-2) },
    { id:'mk2', profile_id:P.nils, amount:5,  reason:'Läxa i tid',                         behavior_id:'bh-laxa',    created_at:at(-3) },
    { id:'mk3', profile_id:P.nils, amount:2,  reason:'Bädda sängen',                       behavior_id:'bh-badda',   created_at:at(-4) },
    { id:'mk4', profile_id:P.ella, amount:10, reason:'Hjälpa till utan att bli tillsagd',  behavior_id:'bh-hjalp',   created_at:at(-2) },
    { id:'mk5', profile_id:P.ella, amount:2,  reason:'Ställa in tallriken',                behavior_id:'bh-tallrik', created_at:at(-3) },
    { id:'mk6', profile_id:P.ella, amount:1,  reason:'Borsta tänderna',                    behavior_id:'bh-tander',  created_at:at(-5) }
  ];
  const markBalances = [ { profile_id:P.nils, marks:27 }, { profile_id:P.ella, marks:13 } ];
  const markRequests = [
    { id:'mr1', profile_id:P.nils, behavior_id:'bh-badda', amount:2, status:'pending', created_at:at(0) },
    { id:'mr2', profile_id:P.ella, behavior_id:'bh-laxa',  amount:5, status:'pending', created_at:at(0) }
  ];

  // Belöningsbutik: parent-made tiers, the rewards inside them, and one pending redemption.
  const rewardTiers = [
    { id:'rt-sma',    title:'Små belöningar',      emoji:'🍦', stars:1,  sort:0, active:true },
    { id:'rt-mellan', title:'Mellanbelöningar',    emoji:'🎢', stars:2,  sort:1, active:true },
    { id:'rt-stora',  title:'Stora & gemensamma',  emoji:'🎡', stars:10, sort:2, active:true }
  ];
  const rewards = [
    { id:'rw-glass', tier_id:'rt-sma',    title:'Glass i affären',        emoji:'🍦', poolable:false, active:true, sort:0 },
    { id:'rw-skarm', tier_id:'rt-sma',    title:'30 min extra skärmtid',  emoji:'🎮', poolable:false, active:true, sort:1 },
    { id:'rw-film',  tier_id:'rt-sma',    title:'Välj fredagsfilmen',     emoji:'🎬', poolable:false, active:true, sort:2 },
    { id:'rw-lek',   tier_id:'rt-mellan', title:'Valfri lekplats',        emoji:'🛝', poolable:false, active:true, sort:0 },
    { id:'rw-bad',   tier_id:'rt-mellan', title:'Badhuset',               emoji:'🏊', poolable:false, active:true, sort:1 },
    { id:'rw-tivoli',tier_id:'rt-stora',  title:'Tivoli med familjen',    emoji:'🎡', poolable:true,  active:true, sort:0 }
  ];
  const redemptions = [
    { id:'rd1', profile_id:P.nils, reward_id:'rw-skarm', cost_marks:10, status:'pending', created_at:at(0) }
  ];

  const budget = {
    currentMonth: month(0),
    deletedMonths: {},
    months: {
      [month(0)]: {
        updatedAt: Date.now(),
        income: [
          grp('Arbetslön', [ { name:'Johan', amount:24000 }, { name:'Anna', amount:14000 } ]),
          grp('Bidrag',    [ { name:'Barnbidrag', amount:2500 } ])
        ],
        expenses: [
          grp('Boende',   [ { name:'Bredband', amount:449 }, { name:'El', amount:1650 }, { name:'Försäkringar', amount:2100 } ]),
          grp('Levande',  [ { name:'Mat', amount:8000 }, { name:'Bränsle', amount:1800 }, { name:'Kläder', amount:900 } ]),
          grp('Lån',      [ { name:'Bolån', amount:9500 }, { name:'Billån', amount:3200 } ]),
          grp('Sparande', [ { name:'Buffert', amount:3000 }, { name:'Fonder', amount:2000 } ]),
          grp('Övrigt',   [ { name:'Telefoner', amount:700 }, { name:'Månadspeng', amount:600 } ])
        ]
      },
      [month(-1)]: {
        updatedAt: Date.now() - 86400000 * 30,
        income: [
          grp('Arbetslön', [ { name:'Johan', amount:24000 }, { name:'Anna', amount:14000 } ]),
          grp('Bidrag',    [ { name:'Barnbidrag', amount:2500 } ])
        ],
        expenses: [
          grp('Boende',   [ { name:'Bredband', amount:449 }, { name:'El', amount:1900 }, { name:'Försäkringar', amount:2100 } ]),
          grp('Levande',  [ { name:'Mat', amount:9200 }, { name:'Bränsle', amount:2200 }, { name:'Kläder', amount:1400 } ]),
          grp('Lån',      [ { name:'Bolån', amount:9500 }, { name:'Billån', amount:3200 } ]),
          grp('Sparande', [ { name:'Buffert', amount:1000 } ]),
          grp('Övrigt',   [ { name:'Telefoner', amount:700 }, { name:'Månadspeng', amount:600 }, { name:'Semester', amount:3500 } ])
        ]
      }
    }
  };

  return {
    meId: P.johan,
    state: { profiles, events, tasks, balances, ledger, payouts, templates, suggestions, votes, messages, todos, meals, mealDishes, mealWishes, shopTopics, shopItems, behaviors, markLedger, markBalances, markRequests, rewardTiers, rewards, redemptions },
    budget
  };
})();
