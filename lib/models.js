class Player {
  constructor(name) {
    this._name = name;
    this._score = 0;
    this._isActive = false;
    this._givenAnswer = false;
    this._finalJeopardyBet = 0;
  }

  get name() {
    return this._name;
  }

  get score() {
    return this._score;
  }

  set score(score) {
    this._score = score;
  }

  get finalJeopardyBet() {
    return this._finalJeopardyBet;
  }

  set finalJeopardyBet(bet) {
    this._finalJeopardyBet = bet;
  }

  get active() {
    return this._isActive;
  }

  set isActive(active) {
    this._isActive = active;
  }

  get givenAnswer() {
    return this._givenAnswer;
  }

  set givenAnswer(answerGiven) {
    this._givenAnswer = answerGiven;
  }
}

class Question {
  constructor(
    category,
    value,
    question,
    answer,
    dailyDouble,
    questionId,
    mediaLink,
    round
  ) {
    this._category = category;
    this._value = value;
    this._question = question;
    this._answer = answer;
    this._dailyDouble = dailyDouble;
    this._questionId = questionId;
    this._mediaLink = mediaLink;
    this._mediaType = 'none';
    this._isProperName = false;
    this._round = round;
  }

  get round() {
    return this._round;
  }

  get category() {
    return this._category;
  }

  get question() {
    return this._question;
  }

  set question(newQuestion) {
    this._question = newQuestion;
  }

  get questionId() {
    return this._questionId;
  }

  set questionId(newQuestionId) {
    this._questionId = newQuestionId;
  }

  get isProperName() {
    return this._isProperName;
  }

  set isProperName(properName) {
    this._isProperName = properName;
  }

  get answer() {
    return this._answer;
  }

  set answer(newAnswer) {
    this._answer = newAnswer;
  }

  get mediaLink() {
    return this._mediaLink;
  }

  set mediaLink(newLink) {
    this._mediaLink = newLink;
  }

  get mediaType() {
    return this._mediaType;
  }

  set mediaType(media) {
    this._mediaType = media;
  }

  get dailyDouble() {
    return this._dailyDouble;
  }

  set dailyDouble(valueDD) {
    this._dailyDouble = valueDD;
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = value;
  }
}

module.exports = { Player, Question };
