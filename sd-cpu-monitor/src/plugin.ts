import streamDeck from "@elgato/streamdeck";
import { CpuAction } from "./cpu-action";

streamDeck.actions.registerAction(new CpuAction());
streamDeck.connect();
