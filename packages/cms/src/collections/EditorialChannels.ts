import type { CollectionConfig } from "payload";
import { isAdminPlus, isStaff } from "../access/roles";
import { EDITORIAL_DISCLOSURE } from "../editorial/lanes";

export const EditorialChannels: CollectionConfig = {
  slug:"editorial-channels",
  dbName:"editorial_channels",
  access:{read:isStaff,create:isAdminPlus,update:isAdminPlus,delete:isAdminPlus},
  admin:{group:"Editorial",useAsTitle:"title",defaultColumns:["title","slug","enabled","disclosure"]},
  fields:[
    {name:"title",type:"text",required:true},
    {name:"slug",type:"text",required:true,unique:true},
    {name:"category",type:"text",required:true},
    {name:"disclosure",type:"text",required:true,defaultValue:EDITORIAL_DISCLOSURE,
      admin:{description:"Must be shown in every public editorial account and content surface."}},
    {name:"enabled",type:"checkbox",defaultValue:false,
      admin:{description:"Admin-controlled. Publishing still requires individual approval."}},
    {name:"profileAuthId",type:"text",
      admin:{description:"Verified dedicated editorial account ID; never create fake human identities."}},
    {name:"editorialNotes",type:"textarea"},
    {name:"quietHours",type:"text",admin:{description:"Timezone-aware quiet window, e.g. 22:00–08:00; scheduling layer TBD"}},
    {name:"sourcePolicy",type:"select",defaultValue:"verified-sources",options:[
      {label:"Verified sources",value:"verified-sources"},
      {label:"Entertainment / fictional",value:"entertainment"},
      {label:"Editorial opinion",value:"opinion"},
    ]},
  ],
};
