globalThis.fetch = async (url, options) => {
  const request = JSON.parse(options.body);
  if (url === 'https://api.typesafe.ai/v1/systemone') {
    const answers = Object.fromEntries(Object.keys(request.questions).map(id => [id, {type:'noul',noul:id==='sufficient'||id==='m1'?0.1:0.95}]));
    return Response.json({model:'jev-1.13.0',answers,usage:{input_tokens:100,output_tokens:20}});
  }
  if (url === 'https://offline.invalid/v1/messages') {
    const text = request.system?.includes('Extract up to eight') ? JSON.stringify({memories:[{type:'memory',key:'first',content:'A mock supported memory.'},{type:'memory',key:'second',content:'A mock unsupported memory.'}]}) : 'FINAL: OFFLINE MOCK ONLY';
    return Response.json({content:[{type:'text',text}],usage:{input_tokens:100,output_tokens:20}});
  }
  throw Error('Offline harness denied an unexpected URL');
};
