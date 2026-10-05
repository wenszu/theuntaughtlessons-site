(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.READINESS_SIGNATURE=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const readinessCopy={
    'Follow-through':{
      sentence:'You move work forward with structure, ownership and steady follow-through.',
      unlock:'Close the loop more consistently'
    },
    'Steadiness':{
      sentence:'You bring calm judgment and a measured pace when pressure rises.',
      unlock:'Create space before reacting'
    },
    'Curiosity':{
      sentence:'You open up useful options before choosing a clear direction.',
      unlock:'Test one more point of view'
    }
  };
  const profileSentences={
    'quiet achiever':'You build trust through focused work and let consistent delivery speak for you.',
    'steady supporter':'You help people stay grounded and keep shared work moving when pressure rises.',
    'go-getter':'You create momentum quickly and keep pushing until the work is finished.',
    'team player':'You bring people together and help the group turn discussion into action.',
    'natural leader':'You step forward early, set direction and give others a clear pace to follow.',
    'people person':'You create momentum by getting people involved and ready to act.'
  };
  const facetEdges={
    'Assertiveness':['Measured voice','Direct voice'],
    'Activity Level':['Deliberate pace','Fast momentum'],
    'Cooperation':['Independent judgment','Collaborative judgment'],
    'Altruism':['Clear boundaries','Practical support']
  };
  const areaEdges={
    'Social energy':['Focused presence','Visible energy'],
    'Warmth':['Candid judgment','Trust through connection']
  };
  function clamp(value){return Math.max(0,Math.min(100,Number(value)||0))}
  function findArea(areaScores,label){return (areaScores||[]).find(a=>a.label===label)}
  function createSignature(input){
    const areaScores=input.areaScores||[];
    const readiness=areaScores.filter(a=>a.kind==='readiness');
    const strongest=readiness.reduce((best,a)=>!best||clamp(a.value)>clamp(best.value)?a:best,null)||{label:'Follow-through',value:50};
    const lowest=readiness.reduce((best,a)=>!best||clamp(a.value)<clamp(best.value)?a:best,null)||strongest;
    const copy=readinessCopy[strongest.label]||readinessCopy['Follow-through'];
    const profileName=String(input.profileName||'Executive profile');
    const sentence=profileSentences[profileName.toLowerCase()]||copy.sentence;
    const unlockCopy=readinessCopy[lowest.label]||readinessCopy['Follow-through'];
    let edge='Balanced presence',distinctiveStyleFacet='';
    const facets=input.facetScores||{};
    const candidates=Object.keys(facetEdges).filter(key=>facets[key]!=null).map(key=>({label:key,value:clamp(facets[key]),distance:Math.abs(clamp(facets[key])-50)}));
    if(candidates.length){
      const selected=candidates.sort((a,b)=>b.distance-a.distance||a.label.localeCompare(b.label))[0];
      distinctiveStyleFacet=selected.label;
      edge=facetEdges[selected.label][selected.value>=50?1:0];
    }else{
      const styles=['Social energy','Warmth'].map(label=>findArea(areaScores,label)).filter(Boolean).map(a=>({...a,distance:Math.abs(clamp(a.value)-50)}));
      if(styles.length){
        const selected=styles.sort((a,b)=>b.distance-a.distance||a.label.localeCompare(b.label))[0];
        distinctiveStyleFacet=selected.label;
        edge=areaEdges[selected.label][clamp(selected.value)>=50?1:0];
      }
    }
    return {
      label:'Your Executive Signature',
      profileName,
      sentence,
      firstPersonSentence:sentence.replace(/^You\b/,'I'),
      edge,
      unlock:unlockCopy.unlock,
      strongestReadinessArea:strongest.label,
      distinctiveStyleFacet
    };
  }
  return {createSignature};
});
