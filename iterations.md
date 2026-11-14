# iteration 0 - ui for model creation

this will be in the create.html page.
this interface allows the user to:
* list all created vibechecks (we call the forms 'vibechecks')
* create a vibecheck
* edit a vibecheck
* preview a vibecheck
* save a vibecheck to json file
* load a vibecheck from json file

the list of vibechecks is saved in localStorage.

the kinds of question will be:
* dimensione: when presenting appears as slider ranging from 0 to 1, the user can assign labels to the minimum and the maximum values
* opposizione: when presenting appears as a slider ranging from -1 to 1 (it snaps to the middle when close to it), the user can assign labels to the minimum and the maximum values.
* testo libero: just a text input, the user creating the model can set a maximum length for the text using a slider (from 1 to 1000 characters) and can decide wheter multiple answers per person are allowed
* scelta: a question with pre-defined choices, the user can optionally set it to allow multiple choice selection

# iteration 1 - better ui and data model

## sections
a vibecheck model should be divided in sections, each section can contain any of questions. each section is kinda like a presentation's slide, the presenter will be able to move through sections while the participants will submit the answer to the questions in a section together.
in this iterations we just modify the create.html UI and the data model, in order to handle sections.
for the ui we want a section to be represented with the .card style, that is now being used for the questions. the questions in each section just have a border on the left, in order to graphically discern them. the section have a title that is optional, if the title is missing it's just now shown on the page.

## other ui improvements
the opposition question's slider will have a tick in the middle and the slider snaps to the middle when the user moves it close to it.
the preview will open as a modal that can be closed ('x' button on top right) and will allow the user to mode trough the sections like they were slides of a presentation.
in the 'edit' view there will be a '+ sezione' button at the beginning, at the end and between subsequent secions that creates a new section. similarly, inside each section, at the beginning, end and between subsequent questions there will be a '+ domanda' button.
this '+ domanda' button opens a modal that graphically shows the types of question inside clickable squares (flex wrap it). each square has a background color that corresponds to the question kind and contains a simple example of how the question looks like:
* dimension: 'dimensione' centered at the top, underneath there is a slider with labels '0' and '∞'
* opposition: 'opposizione' centered at the top, underneath there is a slider with labels 'no' and 'yes'
* text: 'testo' centered at the top, underneath there is text 'domanda' and an input with placeholder 'scrivi la risposta'
* choice: 'scelta' centered at the top, underneath there is and example of a multiple choice question 'domanda' with options 'uno', 'due' and 'tre'.
when the user clicks one of these squares the question is created
also, the default labels for a new dimension question must be '0' and '∞', for a new opposition question they must be 'no' and 'yes'.


# iteration 2 - let's go live
now we will allow the presenter to start a live session and share it with the participans.
it will be just a link for now, no qr code generation.
the presenter will move from one section to the other, after a section has been answered the ppresenter will be able to close the poll and move to a view where the results are shown, then she will be able to go on to the next section.
the view where results are shown should be very simple for now, we will work on that in the next iterations. just average and variance for dimensions and oppositions, counts for choices, list of answers for text.
while the participants are answering the presenter's view should show the question and the number of answers submitted, upating live.

the id for the 'session' is generated on the backend, the participants will visit `/live.html?id=sessionId`, the presenter's page url will look like `/live-present.html?id=sessionId`. upon starting a live session the presente will be given a nonce (a random string) generated on the backend, the presenter will save it in localstorage, this will serve as some weak authentication so that if a participant tries to change their url to the presenter's url they will be blocked because they don't have the nonce.

## backend
in the backend create a Store class that keeps the state of the whole app in a big js object. and exposes methods to read and write it.
users will be identified with ids generated on the backend and saved on the client via cookies.

## iteration 2.1 - better answer visualization

here we upgrade the way answers are presented in the presenter live view.
each answer will have summary view and a detailed view (default is the summary view). for each question a small button in the top right corner allows to toggle between these two views.
there will be graphs drawn using canvas.

### dimensions and oppositions
summary view is exacly as it is now. detailed view shows a  vertical bar plot with the answer's distribution counts. the number of bars is 7 (but make it easily configurable).
this graph will have a fixed aspect ratio (4:3, but make it easily configurable).

### text
here we will group answers that are equal to each other and count them.
summary view shows the 3 most common answers with counts. detailed view shows all the answers with counts, in decreasing order by count. each answer is shown inside a white box with rounded corners, the count is shown in the top right of that box. answers with count 1 don't show the count.
detailed view has a max-height and scrolls internally.

### choice
summary view shows chips with the answer text (ellipsed if longer than 20 characters) and the count of answers. detailed view shows a horizontal barplot with a bar for each answer.
this graph's height will be proportional to the number of choices.

# iteration 3 - refactoring and store recovery

we're gonna refactor the backend and allow for the data of active live sessions to be recovered between server restarts.

## iteration 3.1 - refactoring
create folder src/server, src/server.ts becomes src/server/index.ts, move store.ts inside server folder.
create classes WsServer and HTTPServer on the backend so that the src/server/index.ts stays lean and clean. it will create one instance of both, pass configurations to them and start them. the store is also instantiated in the index and passed to WsServer and HTTPServer if needed.

## iteration 3.2 - making store ws free 
do not store ws sockets in the Store class, the Store should know absolutely nothing about websockets. it should just store plain json data that can be stringified. once you did that, make the Store periodically save it's whole state to a file. on startup if the file exists load it in the store (before starting the HTTPServer and the WSServer)


# iteration 4 - custom plots

we wanna make new kinds of plots and allow the presenter to create custom plots that correlate multiple question results. put all the plotting functions in src/client/plot.ts (they take as arguments canvas ctx and all other parameters necessary for the plot). try to split the code into functions that can be reused in for different kinds of graph (for example a drawHorizontalAxis)

## iterations 4.1 - new numeric plots
For numeric answers (dimension and opposition):
* 1d scatter plot: one horizontal axis with transparent dots scattered along the line (more transparent the more answers there are). there is a checkbox 'aggrega' that does a k-means (or something like that) to group the dots, in the plot the surface of the dots is proportional to the number of elements in them.
* continuous density plot

the default graph becomes the 1d scatter (remove the slided with avg).
instead of the 'riepilogo'/'dettaglio' button there will be two small buttons with arrows that move between the 3 kinds of graph (1d scatter, discrete density, continuous density).


