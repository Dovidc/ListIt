const reactRuntime = window.React;
if (!reactRuntime) {
  throw new Error('ListIt web client requires React to be loaded before the app script.');
}

const reactDomRuntime = window.ReactDOM;
if (!reactDomRuntime || typeof reactDomRuntime.createRoot !== 'function') {
  throw new Error('ListIt web client requires ReactDOM 18 to be loaded before the app script.');
}

const {
  Fragment,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useContext,
  useRef
} = reactRuntime;

const createElement = reactRuntime.createElement;

export {
  reactRuntime as React,
  reactDomRuntime as ReactDOM,
  Fragment,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useContext,
  useRef,
  createElement
};
