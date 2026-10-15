import type { CollectionConfig } from "payload";
import { isAdminPlus, canModerate } from "../access/roles";
export const EditorialQueue: CollectionConfig = {
 slug:"editorial-queue",
 dbName:"editorial_queue",
 access:{read:canModerate,create:canModerate,update:canModerate,delete:isAdminPlus},
 admin:{group:"Editorial",useAsTitle:"headline",defaultColumns:["headline","channel","stage","scheduledAt"]},
 fields:[
   {name:"headline",type:"text",required:true},
   {name:"channel",type:"relationship",relationTo:"editorial-channels",required:true},
   {name:"body",type:"textarea",required:true},
   {name:"stage",type:"select",defaultValue:"draft",required:true,options:[
     {label:"Draft",value:"draft"},{label:"Review",value:"review"},
     {label:"Approved",value:"approved"},{label:"Scheduled",value:"scheduled"},
     {label:"Published",value:"published"},{label:"Paused",value:"paused"},
     {label:"Rejected",value:"rejected"},
   ]},
   {name:"sourceUrl",type:"text",admin:{description:"Required for factual news, historical quotes and sourced media"}},
   {name:"sourceNotes",type:"textarea"},
   {name:"moderationNotes",type:"textarea"},
   {name:"approvedBy",type:"relationship",relationTo:"admin-users"},
   {name:"scheduledAt",type:"date"},
   {name:"publishOperationKey",type:"text",unique:true,
    admin:{description:"Stable idempotency key. No automatic publisher is installed."}},
   {name:"publishedPostId",type:"text"},
 ],
};
