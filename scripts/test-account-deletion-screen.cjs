/* global __dirname */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const text=n=>n==null||typeof n==='boolean'?'':typeof n!=='object'?String(n):Array.isArray(n)?n.map(text).join(''):text(n.props?.children);
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
function harness(restored=null, options={}) {
 const slots=[],effects=[];let cursor=0,tree;const calls=[];const receipt={id:'fixture-operation',secret:'fixture-secret',userId:'fixture-user'};
 const state={finish:'pending',blocked:false,readError:!!options.readError,clearError:false};let dismissals=0,reads=0;
 const renderedComponents=new Set();
 const React={createElement:(type,props,...children)=>renderedComponents.has(type)?type({...props,children}):({type,props:{...props,children}}),
  createContext:()=>({Provider:'Provider'}),useContext:()=>()=>{},
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(fn){const i=cursor++;if(!(i in slots)){slots[i]=true;effects.push(fn);}},
 };
 const mocks={'@/components/LoadingState':require('./loading-test-mock.cjs'),react:React,'@expo/vector-icons':{Ionicons:'Icon'},'react-native':{StyleSheet:{create:s=>s},Pressable:'Pressable',Keyboard:{dismiss:()=>{dismissals++;}},ActivityIndicator:'Spinner',KeyboardAvoidingView:'Keyboard',Platform:{OS:'android'},ScrollView:'Scroll',Text:'Text',TextInput:'Input',View:'View'},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:24,bottom:24})},
  './AuthContext':{useAuth:()=>({user:options.signedOut?null:{id:options.otherUser?'other-user':'fixture-user',email:'fixture@example.test'},signOut:async()=>{calls.push('signout');return null;}})},
  '../components/ModerationShell':{ModerationButton:'Button',moderationStyles:{}},
  '../lib/accountDeletion':{readDeletionReceipt:async()=>{reads++;if(state.readError)throw Error('storage unavailable');return restored;},clearDeletionReceipt:async()=>{calls.push('clear');if(state.clearError)throw Error('storage unavailable');},clearDeletedAccountDrafts:async id=>{calls.push('drafts:'+id);},
   confirmAccountDeletion:async(id,email,password,existing,saved)=>{calls.push('confirm');if(state.blocked)throw Error('Finish or cancel accepted jobs before deleting your account.');saved(receipt);return receipt;},
   finishAccountDeletion:async()=>{calls.push('finish');return state.finish;},
  },
 };
 const exports={};const code=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/context/AccountDeletionProvider.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 function requireModule(n){
  if(n.endsWith('/ProfileActionRow')&&!(n in mocks)){
   const row={};const rowCode=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/components/ProfileActionRow.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
   vm.runInNewContext(rowCode,{exports:row,require:requireModule});mocks[n]=row;renderedComponents.add(row.default);
  }
  assert.ok(n in mocks,n);return mocks[n];
 }
 vm.runInNewContext(code,{exports,Error,require:requireModule});
 function render(){cursor=0;tree=exports.AccountDeletionProvider({children:'Normal app'});while(effects.length)effects.shift()();}
 function button(title){return nodes(tree).find(n=>n.type==='Button'&&n.props.title===title);}
 function press(title){const b=button(title);assert.ok(b,title);if(!b.props.disabled)b.props.onPress();render();}
 function fill(label,value){const input=nodes(tree).find(n=>n.type==='Input'&&n.props.accessibilityLabel===label);assert.ok(input,label);input.props.onChangeText(value);render();}
 async function settle(){for(let i=0;i<5;i++){await new Promise(setImmediate);render();}}
 render();return{state,calls,button,press,fill,settle,reads:()=>reads,dismissals:()=>dismissals,open(){tree.props.value();render();},text:()=>text(tree),tree:()=>tree,receipt};
}
(async()=>{
 const h=harness();
 assert.equal(nodes(h.tree()).find(n=>n.type==='LoadingState')?.props.title,'Opening Clu');
 assert.doesNotMatch(h.text(),/Delete your account|Permanently delete account/);
 assert.equal(h.button('Permanently delete account'),undefined);
 assert.equal(h.calls.length,0,'Loading a saved receipt never starts deletion');
 await h.settle();assert.match(h.text(),/Normal app/);h.open();
 assert.match(h.text(),/Your remaining points are saved/);assert.match(h.text(),/Deleted student/);assert.equal(h.button('Permanently delete account').props.disabled,true);
 h.fill('Account password','not-stored');
 const password=nodes(h.tree()).find(n=>n.type==='Input'&&n.props.accessibilityLabel==='Account password');
 const confirm=nodes(h.tree()).find(n=>n.type==='Input'&&n.props.accessibilityLabel==='Type DELETE to confirm');
 let focused=0;confirm.props.ref.current={focus:()=>{focused++;}};
 password.props.onSubmitEditing();assert.equal(focused,1,'Next focuses confirmation');assert.equal(h.calls.length,0,'Next never submits deletion');
 const before=h.dismissals();confirm.props.onSubmitEditing();assert.equal(h.dismissals(),before+1,'Done dismisses the keyboard');assert.equal(h.calls.length,0,'Done never submits deletion');
 assert.equal(password.props.value,'not-stored','Moving focus preserves the password');
 h.fill('Type DELETE to confirm','delete');h.press('Permanently delete account');assert.equal(h.calls.length,0);
 h.fill('Type DELETE to confirm','DELETE');h.state.blocked=true;h.press('Permanently delete account');await h.settle();assert.match(h.text(),/Finish or cancel accepted jobs/);assert.ok(h.button('Keep my account'));assert.equal(h.calls.includes('signout'),false);
 h.state.blocked=false;h.fill('Account password','not-stored');h.press('Permanently delete account');await h.settle();assert.match(h.text(),/Finishing account deletion/);assert.equal(h.button('Keep my account'),undefined);assert.equal(h.button('Permanently delete account'),undefined);
 h.state.finish='complete';h.press('Check deletion status');await h.settle();assert.match(h.text(),/Account deleted/);assert.deepEqual(h.calls.slice(-3),['drafts:fixture-user','signout','clear']);h.press('Return to sign in');assert.match(h.text(),/Normal app/);
 const resumed=harness(h.receipt);await resumed.settle();assert.match(resumed.text(),/Finishing account deletion/);
 resumed.state.finish='unconfirmed';resumed.press('Check deletion status');await resumed.settle();
 assert.match(resumed.text(),/Deletion status unavailable/);assert.match(resumed.text(),/90 days after cleanup finishes/);
 assert.equal(resumed.button('Permanently delete account'),undefined);
 resumed.press('Retry confirmation');assert.ok(resumed.button('Permanently delete account').props.disabled);
 assert.deepEqual(resumed.calls,['finish'],'Retry requires fresh explicit confirmation');
 for(const options of [{signedOut:true},{otherUser:true}]) {
   const absent=harness(h.receipt,options);await absent.settle();
   absent.press('Check deletion status');await absent.settle();
   assert.ok(absent.button('Check deletion status'));assert.equal(absent.button('Remove saved receipt'),undefined);
   absent.state.finish='unconfirmed';absent.press('Check deletion status');await absent.settle();
   assert.equal(absent.button('Retry confirmation'),undefined);
   absent.state.clearError=true;absent.press('Remove saved receipt');await absent.settle();
   assert.match(absent.text(),/Unable to remove the saved receipt/);
   absent.state.clearError=false;absent.press('Remove saved receipt');await absent.settle();assert.match(absent.text(),/Normal app/);
   assert.deepEqual(absent.calls,['finish','finish','clear','clear'],'Discard clears only local receipt state');
 }
 const failedRead=harness(null,{readError:true});await failedRead.settle();
 assert.match(failedRead.text(),/Unable to open Clu/);assert.match(failedRead.text(),/Unable to load your saved account deletion/);
 assert.ok(!nodes(failedRead.tree()).some(n=>n.type==='LoadingState'));assert.ok(failedRead.button('Retry'));
 assert.doesNotMatch(failedRead.text(),/Delete your account/);assert.equal(failedRead.calls.length,0);
 failedRead.state.readError=false;failedRead.press('Retry');assert.equal(nodes(failedRead.tree()).find(n=>n.type==='LoadingState')?.props.title,'Opening Clu');
 await failedRead.settle();assert.match(failedRead.text(),/Normal app/);assert.equal(failedRead.reads(),2);
 console.log('PASS deletion screen: explicit confirmation, blocked jobs, pending recovery, disabled duplicate submit, restart recovery and completed sign-out');
})().catch(e=>{console.error(e);process.exitCode=1;});
