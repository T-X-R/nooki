import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import capability from '../index'
import {fixture} from '../scripts/tests/fake-host'
import './theme.css'
import './style.css'
const qa=fixture({loseAttachmentReply:true});Object.assign(window,{qa})
function App(){const [key,setKey]=useState(0);return <><aside className="preview-toolbar"><strong>Synthetic Host fixture · No real model or native grants</strong><button onClick={()=>setKey(key+1)}>Reopen package</button></aside><div className="preview-content" style={{maxWidth:1100}}><capability.Page key={key} host={qa.host}/></div></>}
createRoot(document.getElementById('root')!).render(<App/> )
