/* global __dirname */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const text=n=>n==null||typeof n==='boolean'?'':typeof n!=='object'?String(n):Array.isArray(n)?n.map(text).join(''):text(n.props?.children);
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const stamp='2026-11-14T12:00:00Z';
function harness({pending=null, unavailable=false, target='request', warningCount=0}={}) {
 const slots=[],effects=[],cleanups=[];let cursor=0,tree,listener,invalidations=0;const calls=[];
 const state={ready:false,busy:false,pending,receipt:null,conflict:false,accessLost:false,error:''};
 const context={label:'Fixture target',updatedAt:stamp,warningCount,suspendedUntil:null,evidence:[{label:'Description',value:'Please check this content.'}]};
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
  useEffect(fn,deps){const i=cursor++;if(!(i in slots)||!deps.every((v,k)=>Object.is(v,slots[i][k]))){slots[i]=deps;effects.push(fn);}},
 };
 const model={getState:()=>({...state}),subscribe:fn=>{listener=fn;return()=>{};},restore:async()=>{state.ready=true;listener();},dispose:()=>calls.push('dispose'),
  submit:async fields=>{calls.push(fields??'retry');state.receipt={automatic_suspension:false};state.pending=null;listener();},clearConflict:async()=>true};
 const choices=target=>target==='request'?['remove_request','warn','suspend_7_days']:target==='course_review'?['remove_review','warn','suspend_7_days']:['warn','suspend_7_days'];
 const labels={remove_request:'Remove request',remove_review:'Hide course review',warn:'Issue a warning',suspend_7_days:'Suspend for 7 days'};
 const mocks={react:React,'expo-router':{},'react-native':{ActivityIndicator:'Spinner',KeyboardAvoidingView:'Keyboard',Platform:{OS:'android'},ScrollView:'Scroll',Text:'Text',TextInput:'Input',View:'View'},
  '../../context/AuthContext':{},'../../components/ModerationShell':{ModerationButton:'Button',moderationStyles:{}},
  '../../lib/moderation':{decisionValidation:s=>s.trim().length<10,moderationAccessLost:e=>e.code==='42501'},
  '../../lib/directModeration':{directChoices:choices,createDirectAction:()=>model,getDirectContext:async()=>{if(unavailable)throw Error('removed');return context;}},
  '../../lib/moderationEnforcement':{enforcementLabel:k=>labels[k]},'../../lib/safetyReports':{},
 };
 const exports={};const code=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/app/moderation/direct.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{exports,require:n=>{assert.ok(n in mocks,n);return mocks[n];}});
 const invalidate=()=>{invalidations++;};
 function render(){cursor=0;tree=exports.DirectAction({userId:'actor',id:'target',target,invalidate});while(effects.length){const cleanup=effects.shift()();if(cleanup)cleanups.push(cleanup);}}
 function button(title){return nodes(tree).find(n=>n.type==='Button'&&n.props.title===title);}
 function press(title){const b=button(title);assert.ok(b,title);if(!b.props.disabled)b.props.onPress();render();}
 function fill(value){const input=nodes(tree).find(n=>n.type==='Input');assert.ok(input);input.props.onChangeText(value);render();}
 async function settle(){for(let i=0;i<5;i++){await new Promise(setImmediate);render();}}
 render();return{calls,button,press,fill,settle,text:()=>text(tree),nodes:()=>nodes(tree),close:()=>cleanups.forEach(fn=>fn()),
  update(patch){Object.assign(state,patch);listener();render();},invalidations:()=>invalidations};
}
(async()=>{
 let h=harness();await h.settle();assert.equal(h.button('Review action').props.disabled,true);h.fill('tiny');h.press('Review action');assert.equal(h.button('Confirm action'),undefined);
 h.fill('Please follow the community rules.');h.press('Review action');assert.match(h.text(),/Reserved points are released/);assert.equal(h.calls.length,0);
 h.press('Keep editing');assert.equal(h.calls.length,0);h.press('Review action');h.press('Confirm action');await h.settle();
 assert.equal(h.calls[0].reviewUpdatedAt,stamp);assert.equal(h.calls[0].kind,'remove_request');assert.match(h.text(),/Action recorded/);assert.equal(h.button('Confirm action'),undefined);h.close();
 console.log('PASS explanation, explicit confirmation, cancellation and confirmed success');
 h=harness({target:'course_review'});await h.settle();assert.equal(h.button('Remove request'),undefined);h.fill('Misleading review must be revised.');h.press('Review action');assert.match(h.text(),/student can publish a revised review/);
 assert.equal(h.nodes().find(n=>n.type==='Keyboard').props.behavior,'height');assert.equal(h.nodes().find(n=>n.type==='Scroll').props.keyboardShouldPersistTaps,'handled');h.close();
 console.log('PASS review actions preserve revision option and keyboard-friendly layout');
 h=harness({target:'student',warningCount:2});await h.settle();assert.equal(h.button('Hide course review'),undefined);h.fill('This is a repeated community rule violation.');h.press('Review action');assert.match(h.text(),/third warning also suspends access/);h.close();
 console.log('PASS student actions and third-warning confirmation');
 h=harness({unavailable:true,pending:{kind:'remove_request',reason:'Saved explanation after network loss.'}});await h.settle();assert.match(h.text(),/Saved explanation/);assert.ok(h.button('Retry saved action'));h.press('Retry saved action');await h.settle();assert.deepEqual(h.calls,['retry']);h.close();
 console.log('PASS committed removal can reconcile receipt even if target is now unavailable');
 h=harness({unavailable:true});await h.settle();assert.ok(h.button('Reload item'));assert.equal(h.button('Review action'),undefined);h.close();
 console.log('PASS unavailable context prevents new actions');
 h=harness();await h.settle();h.update({accessLost:true});assert.equal(h.invalidations(),1);h.close();
 console.log('PASS access loss invalidates admin gate');
 console.log('Direct moderation screen: 6 checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
