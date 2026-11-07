import fs from 'node:fs';
import {createEpisode} from '../../scripts/paired-ledger/ledger.mjs';
const episodes=new Map([447701,117701,227701].map(seed=>[seed,createEpisode(seed)]));
globalThis.fetch=async(url,options)=>{
  const request=JSON.parse(options.body);
  const events=fs.readFileSync(process.env.PILOT_MOCK_OUTPUT+'/events.jsonl','utf8').trim().split('\n');
  const dispatch=JSON.parse(events.at(-1));
  if(dispatch.type!=='dispatch')throw new Error('Missing durable dispatch before transport');
  if(JSON.stringify(request).includes('"expected"'))throw new Error('Oracle field leaked to participant');
  if(process.env.PILOT_MOCK_FAIL==='missing-usage'||(process.env.PILOT_MOCK_FAIL==='native-missing-usage'&&String(url).includes('api.typesafe.ai')&&dispatch.context.phase!=='calibration-native'))return Response.json({model:request.model,content:[]});
  if(String(url).includes('api.z.ai')){
    const context=dispatch.context;
    const turn=episodes.get(context.seed).turns[context.turn-1];
    const malformed=process.env.PILOT_MOCK_FAIL==='transcript-malformed'&&context.phase==='development-baseline'&&context.arm==='transcript'&&context.turn===2;
    if(process.env.PILOT_MOCK_FAIL==='transcript-malformed'&&context.phase==='development-baseline'&&context.arm==='transcript'&&context.turn===3&&!request.messages.some(row=>row.role==='assistant'&&row.content==='FINAL {broken'))throw new Error('Malformed turn vanished from full transcript');
    const text=malformed?'FINAL {broken':'FINAL '+JSON.stringify({answer:JSON.stringify({answer:turn.expected}),state:[{type:'fact',key:'event-'+turn.turn,content:turn.input}]});
    const raw={model:request.model,id:'offline-'+dispatch.id,stop_reason:'end_turn',usage:{input_tokens:Math.ceil(Buffer.byteLength(JSON.stringify(request))/8),output_tokens:80},content:[{type:'text',text},{type:'thinking',thinking:'PRIVATE_OFFLINE_CANARY'}]};
    return Response.json(raw);
  }
  if(String(url).includes('api.typesafe.ai')&&process.env.PILOT_MOCK_FAIL==='native-invalid'&&dispatch.context.phase!=='calibration-native')return Response.json({model:request.model,answers:{unexpected:{type:'noul',noul:2}},usage:{input_tokens:20,output_tokens:1}});
  if(String(url).includes('api.typesafe.ai'))return Response.json({model:request.model,answers:Object.fromEntries(Object.keys(request.questions).map((key,i)=>[key,{type:'noul',noul:i===0?1:0}])),usage:{input_tokens:Math.ceil(Buffer.byteLength(JSON.stringify(request))/8),output_tokens:2}});
  throw new Error('Offline test attempted external network');
};
