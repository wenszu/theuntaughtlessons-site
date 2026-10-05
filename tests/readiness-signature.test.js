const test=require('node:test');
const assert=require('node:assert/strict');
const {createSignature}=require('../apps/readiness-assessment/signature.js');

const areas=[
  {label:'Follow-through',kind:'readiness',value:78},
  {label:'Steadiness',kind:'readiness',value:62},
  {label:'Curiosity',kind:'readiness',value:45},
  {label:'Social energy',kind:'style',value:50},
  {label:'Warmth',kind:'style',value:50}
];

test('uses the exact tier labels and stays deterministic',()=>{
  const input={profileName:'Quiet Strategist',areaScores:areas,facetScores:{Assertiveness:28,Cooperation:72},tier:'quick'};
  const first=createSignature(input);
  assert.deepEqual(createSignature(input),first);
  assert.equal(first.label,'Your Executive Signature');
  assert.equal(createSignature({...input,tier:'full'}).label,'Your Executive Signature');
});

test('keeps the signature sentence concise and first person for sharing',()=>{
  const result=createSignature({profileName:'Quiet Strategist',areaScores:areas,tier:'quick'});
  const count=result.firstPersonSentence.trim().split(/\s+/).length;
  assert.ok(count>=8&&count<=16,`expected 8–16 words, received ${count}`);
  assert.match(result.firstPersonSentence,/^I\b/);
});

test('treats a low Cooperation style score as independent judgment',()=>{
  const result=createSignature({profileName:'Quiet Strategist',areaScores:areas,facetScores:{Cooperation:12,Assertiveness:48},tier:'full'});
  assert.equal(result.edge,'Independent judgment');
  assert.equal(result.distinctiveStyleFacet,'Cooperation');
});

test('derives Unlock from the lowest readiness area and never from style',()=>{
  const result=createSignature({profileName:'Quiet Strategist',areaScores:areas,facetScores:{Assertiveness:1},tier:'full'});
  assert.equal(result.strongestReadinessArea,'Follow-through');
  assert.equal(result.unlock,'Test one more point of view');
});

test('allows the same profile to have different style edges',()=>{
  const base={profileName:'Quiet Strategist',areaScores:areas,tier:'full'};
  const reserved=createSignature({...base,facetScores:{Assertiveness:10}});
  const direct=createSignature({...base,facetScores:{Assertiveness:90}});
  assert.equal(reserved.profileName,direct.profileName);
  assert.notEqual(reserved.edge,direct.edge);
});

test('uses the established profile to lead the signature sentence',()=>{
  const result=createSignature({profileName:'Natural leader',areaScores:areas,tier:'quick'});
  assert.equal(result.sentence,'You step forward early, set direction and give others a clear pace to follow.');
  assert.match(result.firstPersonSentence,/^I step forward early/);
});

test('returns complete deterministic copy across score boundaries',()=>{
  const profiles=['Quiet achiever','Steady supporter','Go-getter','Team player','Natural leader','People person'];
  const boundaries=[0,39,40,50,59,60,79,80,100];
  for(const profileName of profiles){
    for(const value of boundaries){
      const input={
        profileName,
        tier:'full',
        areaScores:[
          {label:'Follow-through',kind:'readiness',value},
          {label:'Steadiness',kind:'readiness',value:100-value},
          {label:'Curiosity',kind:'readiness',value:50},
          {label:'Social energy',kind:'style',value},
          {label:'Warmth',kind:'style',value:100-value}
        ],
        facetScores:{Assertiveness:value,Cooperation:100-value}
      };
      const result=createSignature(input);
      assert.deepEqual(createSignature(input),result);
      for(const key of ['label','profileName','sentence','firstPersonSentence','edge','unlock','strongestReadinessArea','distinctiveStyleFacet']){
        assert.equal(typeof result[key],'string');
        assert.ok(result[key].trim(),`${profileName} at ${value} has empty ${key}`);
        assert.doesNotMatch(result[key],/undefined|null|NaN/);
      }
    }
  }
});
