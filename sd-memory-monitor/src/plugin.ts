import streamDeck from "@elgato/streamdeck";
import { MemoryAction } from "./memory-action";

streamDeck.actions.registerAction(new MemoryAction());
streamDeck.connect();
