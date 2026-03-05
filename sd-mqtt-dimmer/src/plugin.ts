import streamDeck from "@elgato/streamdeck";
import { DimmerAction } from "./dimmer-action";

streamDeck.actions.registerAction(new DimmerAction());
streamDeck.connect();
