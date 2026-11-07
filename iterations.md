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

