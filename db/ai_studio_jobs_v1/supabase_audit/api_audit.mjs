// PIENHS CULT OS / AI Studio MVP — audyt API migracji ai_studio_jobs_v1 na lokalnym stosie Supabase.
// PostgREST z prawdziwymi JWT (anon, authenticated, service_role), Auth (użytkownicy), Realtime z RLS.
// Wejście (env): SB_API_URL, SB_ANON_KEY, SB_SERVICE_KEY. Wyjście: PASS / FAIL / INFO; exit 1 przy FAIL.
// Klucze nie są wypisywane. Każdy przebieg tworzy własnych użytkowników i projekty.
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const url = process.env.SB_API_URL;
const anonKey = process.env.SB_ANON_KEY;
const serviceKey = process.env.SB_SERVICE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error('Brak SB_API_URL / SB_ANON_KEY / SB_SERVICE_KEY.');
  process.exit(2);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, serviceKey, opts);
const anon = createClient(url, anonKey, opts);

let passes = 0;
let fails = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    passes += 1;
    console.log(`PASS ${name}`);
  } else {
    fails += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
};
const info = (msg) => console.log(`INFO ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fmt = (r) => JSON.stringify({ http: r.status, code: r.error?.code ?? null, message: r.error?.message ?? null });
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('hex');
const good = () => ({
  prompt: 'Dark phonk, distorted 808, cowbell lead, 140 BPM, tape saturation',
  negativePrompt: 'bright pop',
  description: 'Mroczny phonk z cowbellem.',
  tags: ['dark phonk', 'cowbell', '808'],
  structure: [{ section: 'Intro', description: 'mgła, szum taśmy' }],
  vocalInstructions: ['low male growl, pitched -4'],
  productionNotes: ['tape saturation on the bus'],
  model: 'audit-model',
});

async function makeUser(tag) {
  const email = `${tag}-${randomUUID()}@audit.local`;
  const password = randomBytes(18).toString('base64url');
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`createUser ${tag}: ${created.error.message}`);
  const client = createClient(url, anonKey, opts);
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error(`signInWithPassword ${tag}: ${signed.error.message}`);
  return { id: created.data.user.id, client, accessToken: signed.data.session.access_token };
}

const createJob = (client, userId, projectId, title) =>
  client.rpc('mgj_create', {
    p_user_id: userId,
    p_project_id: projectId,
    p_request_id: randomUUID(),
    p_working_title: title,
    p_idea: 'Idea audytu',
    p_input: {},
  });

const countJobs = async (userId) => {
  const r = await admin.from('music_generation_jobs').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (r.error) throw new Error(`countJobs: ${r.error.message}`);
  return r.count;
};

async function main() {
  // 0. Cache schematu PostgREST: funkcje widoczne po migracji.
  let ready = null;
  for (let i = 0; i < 30; i += 1) {
    ready = await admin.rpc('mgj_fail', { p_job_id: randomUUID(), p_error_code: 'probe' });
    if (ready.error?.message === 'mgj_job_not_found') break;
    await sleep(1000);
  }
  check('A00 PostgREST: funkcje mgj_* dostępne dla service_role', ready.error?.message === 'mgj_job_not_found', fmt(ready));

  // 1. Dane: 2 użytkowników (Auth) i ich projekty.
  const A = await makeUser('a');
  const B = await makeUser('b');
  const pr = await admin
    .from('projects')
    .insert([
      { user_id: A.id, title: 'Audyt A' },
      { user_id: B.id, title: 'Audyt B' },
    ])
    .select('id,user_id');
  if (pr.error) throw new Error(`projects: ${pr.error.message}`);
  const pA = pr.data.find((p) => p.user_id === A.id).id;
  const pB = pr.data.find((p) => p.user_id === B.id).id;

  // 2. Klient nie tworzy jobów i nie wywołuje funkcji backendu.
  let r = await anon.from('music_generation_jobs').select('id');
  check('T01 anon: SELECT jobs odrzucony (42501)', r.error?.code === '42501', fmt(r));
  info(`T01 ${fmt(r)}`);
  r = await createJob(anon, A.id, pA, 'anon');
  check('T02 anon: RPC mgj_create odrzucony', Boolean(r.error) && !r.data, fmt(r));
  info(`T02 ${fmt(r)}`);
  r = await createJob(A.client, A.id, pA, 'klient');
  check('T03 authenticated: RPC mgj_create odrzucony', Boolean(r.error) && !r.data, fmt(r));
  info(`T03 ${fmt(r)}`);
  const n0 = await countJobs(A.id);
  check('T04 po odrzuconych wywołaniach brak jobów', n0 === 0, `jobów: ${n0}`);

  // 3. Backend (service_role) tworzy joby A i B.
  const jA = await createJob(admin, A.id, pA, 'Audyt A1');
  check('T05 service_role: mgj_create A -> queued', jA.data?.status === 'queued' && jA.data?.user_id === A.id, fmt(jA));
  const jB = await createJob(admin, B.id, pB, 'Audyt B1');
  check('T06 service_role: mgj_create B -> queued', jB.data?.status === 'queued' && jB.data?.user_id === B.id, fmt(jB));
  const idA = jA.data?.id;
  const idB = jB.data?.id;

  // 4. RLS i uprawnienia kolumnowe przez PostgREST.
  r = await A.client.from('music_generation_jobs').select('id,user_id');
  check(
    'T07 A widzi tylko własne joby',
    !r.error && r.data.length === 1 && r.data[0].id === idA,
    `${fmt(r)} wiersze=${JSON.stringify(r.data)}`,
  );
  r = await A.client.from('music_generation_jobs').update({ status: 'completed' }).eq('id', idA).select('id');
  const stA = await admin.from('music_generation_jobs').select('status').eq('id', idA).single();
  check('T08 A: UPDATE status odrzucony (42501), status bez zmian', r.error?.code === '42501' && stA.data?.status === 'queued', fmt(r));
  info(`T08 ${fmt(r)}`);
  r = await A.client.from('music_generation_jobs').update({ notified_at: new Date().toISOString() }).eq('id', idA).select('id');
  check('T09 A: UPDATE notified_at własnego joba', !r.error && r.data.length === 1, fmt(r));
  r = await A.client.from('music_generation_jobs').update({ notified_at: new Date().toISOString() }).eq('id', idB).select('id');
  const nB = await admin.from('music_generation_jobs').select('notified_at').eq('id', idB).single();
  check('T10 A: UPDATE cudzego joba = 0 wierszy', !r.error && r.data.length === 0 && nB.data?.notified_at === null, fmt(r));
  r = await A.client.from('prompt_versions').insert({ project_id: pA, user_id: A.id, version_number: 99, prompt_text: 'x' });
  check('T11 A: INSERT prompt_versions odrzucony (42501)', r.error?.code === '42501', fmt(r));
  r = await A.client.from('music_generation_job_tokens').select('job_id');
  check('T12 A: SELECT tokenów odrzucony (42501)', r.error?.code === '42501', fmt(r));
  r = await A.client.rpc('mgj_complete', { p_job_id: idA, p_token_hash: sha256('x'), p_result: good() });
  check('T13 A: RPC mgj_complete odrzucony', Boolean(r.error) && !r.data, fmt(r));
  info(`T13 ${fmt(r)}`);

  // 5. Realtime: A subskrybuje zmiany jobów; RLS ma przepuścić tylko joby A.
  const events = [];
  await A.client.realtime.setAuth(A.accessToken);
  const channel = A.client
    .channel(`audit-${randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'music_generation_jobs' }, (p) => events.push(p));
  const subscribed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMEOUT'), 30000);
    channel.subscribe((status, err) => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        clearTimeout(timer);
        resolve(err ? `${status}: ${err.message}` : status);
      }
    });
  });
  check('T14 Realtime: subskrypcja A', subscribed === 'SUBSCRIBED', subscribed);
  await sleep(3000);

  // 6. Przepływ backendu: dispatch -> complete (A i B).
  const tokA = token();
  const tokB = token();
  r = await admin.rpc('mgj_dispatch', { p_job_id: idA, p_token_hash: sha256(tokA) });
  check('T15 service_role: mgj_dispatch A', !r.error, fmt(r));
  r = await admin.rpc('mgj_dispatch', { p_job_id: idB, p_token_hash: sha256(tokB) });
  check('T16 service_role: mgj_dispatch B', !r.error, fmt(r));
  const vA = await admin.rpc('mgj_complete', { p_job_id: idA, p_token_hash: sha256(tokA), p_result: good() });
  check('T17 service_role: mgj_complete A -> id wersji', !vA.error && typeof vA.data === 'string', fmt(vA));
  const vB = await admin.rpc('mgj_complete', { p_job_id: idB, p_token_hash: sha256(tokB), p_result: good() });
  check('T18 service_role: mgj_complete B -> id wersji', !vB.error && typeof vB.data === 'string', fmt(vB));

  const rowId = (e) => e.new?.id ?? e.old?.id;
  for (let i = 0; i < 40 && !events.some((e) => rowId(e) === idA && e.new?.status === 'completed'); i += 1) await sleep(500);
  await sleep(3000);
  const evA = events.filter((e) => rowId(e) === idA);
  const evB = events.filter((e) => rowId(e) === idB);
  check(
    'T19 Realtime: A dostaje zmiany własnego joba (do completed)',
    evA.some((e) => e.new?.status === 'completed'),
    `zdarzenia A=${evA.length} statusy=${evA.map((e) => e.new?.status).join(',')} wszystkie=${events.length}`,
  );
  check('T20 Realtime: A nie dostaje zmian joba B (RLS)', evB.length === 0, `zdarzenia B=${evB.length}`);
  info(`T19/T20 zdarzenia: A=${evA.length} (${evA.map((e) => `${e.eventType}:${e.new?.status}`).join(',')}), B=${evB.length}`);
  await A.client.removeChannel(channel);

  r = await A.client.from('prompt_versions').select('id,project_id');
  check(
    'T21 A widzi tylko własną wersję',
    !r.error && r.data.length === 1 && r.data[0].id === vA.data,
    `${fmt(r)} wiersze=${JSON.stringify(r.data)}`,
  );

  // 7. Błędy funkcji przez PostgREST: komunikat (kontrakt) + SQLSTATE i HTTP (do mapowania w Edge Function).
  const tokA2 = token();
  const jA2 = await createJob(admin, A.id, pA, 'Audyt A2');
  await admin.rpc('mgj_dispatch', { p_job_id: jA2.data?.id, p_token_hash: sha256(tokA2) });
  const cases = [
    ['E01', 'mgj_invalid_input', () => admin.rpc('mgj_create', { p_user_id: A.id, p_project_id: pA, p_request_id: randomUUID(), p_working_title: '   ', p_idea: 'x', p_input: {} })],
    ['E02', 'mgj_project_not_found', () => createJob(admin, A.id, pB, 'cudzy projekt')],
    ['E03', 'mgj_invalid_token', () => admin.rpc('mgj_complete', { p_job_id: jA2.data?.id, p_token_hash: sha256('zly'), p_result: good() })],
    ['E04', 'mgj_invalid_result', () => admin.rpc('mgj_complete', { p_job_id: jA2.data?.id, p_token_hash: sha256(tokA2), p_result: {} })],
    ['E05', 'mgj_invalid_state', () => admin.rpc('mgj_dispatch', { p_job_id: idA, p_token_hash: sha256('x') })],
    ['E06', 'mgj_job_not_found', () => admin.rpc('mgj_fail', { p_job_id: randomUUID(), p_error_code: 'x' })],
  ];
  for (const [id, expected, call] of cases) {
    const res = await call();
    check(`${id} błąd ${expected} przez PostgREST`, res.error?.message === expected, fmt(res));
    info(`${id} ${expected}: SQLSTATE=${res.error?.code ?? '-'} HTTP=${res.status}`);
  }
  // A ma 1 job aktywny (A2 processing); A3 zajmuje drugi slot, A4 przekracza limit.
  await createJob(admin, A.id, pA, 'Audyt A3');
  const lim = await createJob(admin, A.id, pA, 'Audyt A4');
  check('E07 błąd mgj_limit_active przez PostgREST', lim.error?.message === 'mgj_limit_active', fmt(lim));
  info(`E07 mgj_limit_active: SQLSTATE=${lim.error?.code ?? '-'} HTTP=${lim.status}`);
}

try {
  await main();
} catch (err) {
  fails += 1;
  console.log(`FAIL X99 nieobsłużony błąd audytu :: ${err?.message ?? err}`);
}
console.log(`API: PASS ${passes} / FAIL ${fails}`);
process.exit(fails === 0 ? 0 : 1);
