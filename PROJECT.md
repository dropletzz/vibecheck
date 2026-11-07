# vibecheck

## idea
this app allows users to create "forms" that can be compiled live and whose results can be immediately visualized.
it's meant to be used relatively small contexts where the people using it are all in the same physical space. the presenter shows a qr code on the screen, the participants scan the qr code, access the webapp and can send answers, the results are then gathered and can be shown by the presenter in various ways.

### data model
this app does not have a db nor registered users, no data will be persisted whatsoever. the users will be able to save their form specifications and responses to their forms as json files they can later reupload using the app. the data about forms that are 'active' will live only in-memory as javascript objects and will be automatically deleted after some time.

### users
this app is designed to be used completely anonimoulsy, there will be no registration or data collection about the users. users are gonna be discerned by custom ids geneated on the server and sent to the clients using cookies or some other client side mechanism like localStorage.
for starters we will not care that much about security or protection from attacks like DDOS, even though this might be needed later on.


## coding style
the code should be simple, concise and easily readable and understandable by a human (as much as possible). still, we think it's better to write some code oursevels and have control over it, rather than introducing a new dependency for every little thing we need to do.
we don't like introducing dependencies and we don't like bloated frameworks.



