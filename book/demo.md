# Demo

## Diagrams & Maths

We can use [mermaid](https://mermaid.js.org) diagrams ([live editor](https://mermaid.live)):

```mermaid
graph LR;
    A-->B-->D;
    A-->C;
```

and maths using [katex](https://katex.org/docs/supported.html):

$$
  \mathcal{U} = ( \Phi \times \mathcal{O} )^*
$$

## Alerts

> [!WARNING] 
> We can use the github flavored callouts, documented [here](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts)

> [!NOTE] 
> A friendly note in github.
> How about code blocks?
> ```
> cargo install mdbook-alerts
> ```

## Footnotes

Additional information that would complicate the read-flow can be put into footnotes [^example].

[^example]: Example footnote
