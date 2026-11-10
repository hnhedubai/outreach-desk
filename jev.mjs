import {createHash} from 'node:crypto';

const questions = {
  scaleGeography: {
    type: 'score',
    instructions:'Score scale and geography fit for the named project against the Nordic 10–20 MW target.',
    criteria: [
      '0.1 — materially outside the 10–20 MW target band and target Nordic geography.',
      '0.5 — adjacent scale, such as 5–10 MW or 20–50 MW, or Nordic-adjacent geography.',
      '1.0 — 10–20 MW located in Norway, Sweden, Finland, Denmark or Iceland.'
    ]
  },
  developmentStage: {
    type:'score',
    instructions:'Score development-stage fit for the named project.',
    criteria:[
      '0.1 — no documented stage fit or a stage clearly outside the target window.',
      '0.5 — very early concept or pilot, or late post-FID stage.',
      '1.0 — feasibility through pre-FID, where a partner or investor is genuinely needed.'
    ]
  },
  permitsOfftake: {
    type:'score',
    instructions:'Score permits and PPA/offtake readiness for the named project.',
    criteria:[
      '0.0 — neither permits/approvals nor credible PPA/offtake evidence is documented.',
      '0.5 — an approval application, conditional grant, LOI, MoU, or negotiation is documented.',
      '1.0 — approvals are secured and/or a credible PPA or offtake exists.'
    ]
  },
  bankabilityCapitalNeed: {
    type:'score',
    instructions:'Score bankability and capital-need evidence for the named project.',
    criteria:[
      '0.1 — the project is not investable or is already fully financed.',
      '0.5 — there is a funding gap with weak structure, or a strong structure with no clear funding gap.',
      '1.0 — there is a clear funding gap with an investable structure, such as secured grants, a credible plan, or named institutional support.'
    ]
  },
  seekingInvestment: {
    type: 'noul',
    instructions: 'Is this project actively seeking external capital or a partner right now?',
    criteria: {
      true: 'The supplied project evidence explicitly says it is raising external investors, jointly evaluating options, needs financing to reach FID, or is seeking a co-investor or project partner.',
      false: 'The supplied evidence says the project is already financed, FID has been taken, it is operating, it is state-run and not seeking a partner, or no current partner/capital need is documented.'
    }
  }
};

const error = (status,message) => Object.assign(new Error(message),{status});
const clean = (value,limit) => String(value??'').replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi,'[email removed]').trim().slice(0,limit);
export const jevAvailable = () => Boolean(process.env.TYPESAFE_API_KEY?.trim());

export function jevInput(project,lead){
  const {targeting} = project;
  const state = {
    targeting:{
      project:clean(project.name,80), offer:clean(targeting.offer,6000), ideal:clean(targeting.ideal,6000),
      signals:(targeting.signals||[]).map(signal=>clean(signal.text,140))
    },
    lead:{
      name:clean(lead.name,140), domain:clean(lead.domain,300), country:clean(lead.country,100),
      category:clean(lead.category,120), description:clean(lead.description,8000),
      evidenceReviewedOn:lead.fitReview?.reviewedOn,
      assets:(lead.fitReview?.assets||[]).map(asset=>({
        name:clean(asset.name,140),site:clean(asset.site,300),
        signals:asset.signals.map(signal=>({
          criterion:clean(signal.label,140),status:signal.status,evidence:clean(signal.detail,1500)
        }))
      }))
    }
  };
  const request = {model:process.env.TYPESAFE_MODEL?.trim()||'jev-latest',state,questions};
  return {request,basis:createHash('sha256').update(JSON.stringify(request)).digest('hex'),lead};
}

export function currentJevFit(project,lead){
  return !lead.erasedAt&&lead.jevFit?.basis===jevInput(project,lead).basis;
}

function stageFromEvidence(lead){
 const signals=(lead.fitReview?.assets||[]).flatMap(asset=>asset.signals||[]);
 const stageSignals=signals.filter(signal=>/development\s*stage|stage/i.test(String(signal.label||'')));
 const text=stageSignals.map(signal=>String(signal.detail||'')).join(' ').toLowerCase().replace(/[–—]/g,'-');
 if(/\bfid[\s-]*taken\b/.test(text))return'FID-taken';
 if(/\bfully[\s-]*financed\b/.test(text))return'fully-financed';
 if(/\boperating\b/.test(text)||/\boperational\b/.test(text))return'operating';
 return'';
}

export async function scoreWithJev(input){
 if(!input||Array.isArray(input)||Array.isArray(input.leads)||Array.isArray(input.records)){
  throw error(400,'Jev accepts exactly one lead record per request.');
 }
  if(!jevAvailable())throw error(503,'Set TYPESAFE_API_KEY in the local Outreach Desk environment to score with Jev.');
  const body = JSON.stringify(input.request);
  if(Buffer.byteLength(body)>40000)throw error(422,'The saved fit evidence is too large for one Jev assessment.');
  let response;
  try {
    response = await fetch('https://api.typesafe.ai/v1/systemone',{
      method:'POST',redirect:'error',headers:{
        authorization:'Bearer '+process.env.TYPESAFE_API_KEY.trim(),'content-type':'application/json'
      },body,signal:AbortSignal.timeout(20000)
    });
  } catch (cause) {
    if(cause.name==='TimeoutError')throw error(504,'Jev timed out. Try scoring again.');
    throw error(502,'Jev could not be reached.');
  }
  if(response.status===401||response.status===403)throw error(502,'TypeSafe rejected the configured API key.');
  if(response.status===429)throw error(429,'TypeSafe rate limit reached. Try again later.');
  if(!response.ok)throw error(502,'TypeSafe returned HTTP '+response.status+'.');
  const payload = await response.json().catch(()=>null);
  const answers=payload?.answers||{};
  const seeking = payload?.answers?.seekingInvestment;
  const componentKeys=['scaleGeography','developmentStage','permitsOfftake','bankabilityCapitalNeed'];
  const components=Object.fromEntries(componentKeys.map(key=>[key,answers[key]?.score]));
  if(componentKeys.some(key=>!Number.isFinite(components[key])||components[key]<0||components[key]>1)||
     seeking?.type!=='noul'||!Number.isFinite(seeking.noul)||seeking.noul<0||seeking.noul>1||
     typeof payload.model!=='string'||!payload.model.trim()){
    throw error(502,'TypeSafe returned an invalid Jev component or seeking-investment value.');
  }
  const fitScore=Math.round(componentKeys.reduce((sum,key)=>sum+components[key],0)*100)/100;
  const seekInv=Math.round(seeking.noul*100)/100;
  const fundedStage=['FID-taken','operating','fully-financed'].includes(stageFromEvidence(input.lead));
  const tier=seekInv<=0.5&&fundedStage?'Funded':fitScore>=2.5&&seekInv>=0.6?'Strong':fitScore>=2&&fitScore<2.5&&seekInv>=0.6?'Partial':'Watch';
  return {score:fitScore,components,seekingInvestment:seekInv,tier,model:payload.model.slice(0,100),basis:input.basis,scoredAt:new Date().toISOString()};
}
