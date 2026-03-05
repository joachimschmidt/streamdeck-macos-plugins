import streamDeck from "@elgato/streamdeck";
import { KeypadGraphAction } from "./keypad-graph-action";
import { EncoderGraphAction } from "./encoder-graph-action";

streamDeck.actions.registerAction(new KeypadGraphAction());
streamDeck.actions.registerAction(new EncoderGraphAction());
streamDeck.connect();
