import type {AgentRunSnapshot} from './contract/index.ts'
export const notesSchema={type:'object',properties:{
 language:{type:'string',enum:['zh','en']},summary:{type:'string',minLength:1,maxLength:12000},
 decisions:{type:'array',maxItems:50,items:{type:'string',maxLength:2000}},
 actions:{type:'array',maxItems:50,items:{type:'object',properties:{task:{type:'string',minLength:1,maxLength:2000},owner:{type:['string','null'],maxLength:200},due:{type:['string','null'],maxLength:200}},required:['task','owner','due'],additionalProperties:false}},
 openQuestions:{type:'array',maxItems:50,items:{type:'string',maxLength:2000}},
},required:['language','summary','decisions','actions','openQuestions'],additionalProperties:false} as const
export type MeetingNotes={language:'zh'|'en';summary:string;decisions:string[];actions:{task:string;owner:string|null;due:string|null}[];openQuestions:string[]}
export function noteText(run:AgentRunSnapshot){
 const result=run.result!;if(result.data===undefined)return result.text // Retained text-only runs keep their original output.
 // Nooki validates this data against the frozen notesSchema before marking the run completed.
 const notes=result.data as unknown as MeetingNotes,zh=notes.language==='zh',unknown=zh?'未注明':'Unspecified'
 const list=(items:string[])=>items.length?items.map(item=>`- ${item}`).join('\n'):`- ${zh?'无':'None'}`
 return `## ${zh?'摘要':'Summary'}\n\n${notes.summary}\n\n## ${zh?'决定':'Decisions'}\n\n${list(notes.decisions)}\n\n## ${zh?'行动项':'Action items'}\n\n${list(notes.actions.map(item=>`${item.task} — ${zh?'负责人':'Owner'}: ${item.owner??unknown}; ${zh?'日期':'Date'}: ${item.due??unknown}`))}\n\n## ${zh?'待确认问题':'Open questions'}\n\n${list(notes.openQuestions)}`
}
