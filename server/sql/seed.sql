-- Stage 2 catalogue metadata only. No reviewed lesson, source, or assessment pack
-- exists yet, so every concept remains unavailable for starting a lesson.
insert into public.concepts (id,slug,title,area,objectives,aliases,catalogue_order,supported,content_available) values
('00000000-0000-4000-8000-000000000101','clients-and-servers','Clients and servers','web_communication','[{"id":"client-server-roles","description":"Explain the client and server roles, then trace how a browser request leads to a server response and a displayed page."}]','{"client server model","client-server"}',1,true,false),
('00000000-0000-4000-8000-000000000102','http-requests-and-responses','HTTP requests and responses','web_communication','[{"id":"http-exchange","description":"Trace a browser HTTP exchange and identify the method, path, headers, status, and optional bodies in its request and response."}]','{"http request","http response"}',2,true,false),
('00000000-0000-4000-8000-000000000103','http-methods','HTTP methods','web_communication','[{"id":"method-purpose","description":"Choose a suitable HTTP method for a common action."}]','{"get and post","http verbs"}',3,true,false),
('00000000-0000-4000-8000-000000000104','http-status-codes','HTTP status codes','web_communication','[{"id":"status-meaning","description":"Interpret common HTTP response status classes."}]','{"status codes","http errors"}',4,true,false),
('00000000-0000-4000-8000-000000000105','what-an-api-does','What an API does','apis','[{"id":"api-contract","description":"Explain an API as a software interface, distinguish it from a human interface, and trace a client using an exposed capability."}]','{"api basics","api"}',5,true,false),
('00000000-0000-4000-8000-000000000106','rest-basics','REST basics','apis','[{"id":"rest-resource","description":"Recognise resources and common actions in a REST-style API."}]','{"rest api","rest"}',6,true,false),
('00000000-0000-4000-8000-000000000107','json','JSON','apis','[{"id":"json-structure","description":"Read a simple JSON object or array used by an API."}]','{"javascript object notation"}',7,true,false),
('00000000-0000-4000-8000-000000000108','authentication-versus-authorization','Authentication versus authorization','apis','[{"id":"auth-distinction","description":"Distinguish checking identity from checking permission."}]','{"authn vs authz","authentication and authorization"}',8,true,false),
('00000000-0000-4000-8000-000000000109','tables-and-records','Tables and records','databases','[{"id":"table-record","description":"Identify a table, its typed columns and rows, then match values in an INSERT statement to their named columns."}]','{"database tables","rows and columns"}',9,true,false),
('00000000-0000-4000-8000-000000000110','keys-and-relationships','Keys and relationships','databases','[{"id":"key-relationship","description":"Explain how keys identify and connect records."}]','{"primary keys","foreign keys"}',10,true,false),
('00000000-0000-4000-8000-000000000111','selecting-and-filtering-data','Selecting and filtering data','databases','[{"id":"select-filter","description":"Select records that satisfy a simple filter."}]','{"sql select","where clause"}',11,true,false),
('00000000-0000-4000-8000-000000000112','joins','Joins','databases','[{"id":"join-relationship","description":"Combine records from related tables using a join."}]','{"sql joins","join tables"}',12,true,false)
on conflict (id) do nothing;

-- Conservative prerequisites: each target can be understood after the source.
-- Related edges communicate useful cross-area context without gatekeeping.
insert into public.concept_edges (id,from_concept_id,to_concept_id,relation_type,reviewed) values
('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102','prerequisite',true),
('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000103','prerequisite',true),
('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000104','prerequisite',true),
('00000000-0000-4000-8000-000000000204','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000105','prerequisite',true),
('00000000-0000-4000-8000-000000000205','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000105','prerequisite',true),
('00000000-0000-4000-8000-000000000206','00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000106','prerequisite',true),
('00000000-0000-4000-8000-000000000207','00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000107','related',true),
('00000000-0000-4000-8000-000000000208','00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000108','related',true),
('00000000-0000-4000-8000-000000000209','00000000-0000-4000-8000-000000000109','00000000-0000-4000-8000-000000000110','prerequisite',true),
('00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000109','00000000-0000-4000-8000-000000000111','prerequisite',true),
('00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000110','00000000-0000-4000-8000-000000000112','prerequisite',true),
('00000000-0000-4000-8000-000000000212','00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000112','related',true),
('00000000-0000-4000-8000-000000000213','00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000109','related',true)
on conflict (id) do nothing;
