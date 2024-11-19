import esbuild from "esbuild";
import { sassPlugin } from "esbuild-sass-plugin";
import postcss from "postcss";
import autoprefixer from "autoprefixer";
import fs from "fs-extra";
import path from "path";
import browserSync from "browser-sync";
import chokidar from "chokidar";
const bs = browserSync.create();
import tailwindcss from "tailwindcss";

async function buildHTMLWithPartials() {
  const srcDir = "src/html";
  const outDir = "dist/html";
  const htmlFiles = await fs.readdir(srcDir);
  for (const htmlFile of htmlFiles) {
    if (path.extname(htmlFile) !== ".html") {
      continue;
    }
    const htmlFilePath = path.join(srcDir, htmlFile);
    const outputFilePath = path.join(outDir, htmlFile);
    let htmlContent = await fs.readFile(htmlFilePath, "utf-8");
    const includePattern = /<!--\s*include\s+(.*?)\s*-->/g;
    let match;
    while ((match = includePattern.exec(htmlContent))) {
      const includeComment = match[0];
      const partialPath = match[1];
      try {
        const partialContent = await fs.readFile(
          path.join(srcDir, "partials", partialPath.replace(/"+/g, "")),
          "utf-8"
        );
        htmlContent = htmlContent.replace(includeComment, partialContent);
      } catch (error) {
        console.error(
          `Failed to include partial '${partialPath}': ${error.message}`
        );
      }
    }
    await fs.ensureDir(outDir);
    await fs.writeFile(outputFilePath, htmlContent);
  }
  console.log(`⚡ Processed HTML files ⚡`);
}

async function copyDependencies() {
  const packageJson = await fs.readJson("./package.json");
  const dependencies = Object.keys(packageJson.dependencies);

  await Promise.all(
    dependencies.map(async (dependency) => {
      const dependencyPath = path.join("./node_modules", dependency);
      const distPath = path.join(dependencyPath, "dist");
      const libPath = path.join("./dist/assets/libs", dependency);

      if (await fs.pathExists(distPath)) {
        await fs.copy(distPath, libPath);
      } else {
        await fs.copy(dependencyPath, libPath);
      }
    })
  );
}

async function copyAssets() {
  const srcAssetsDir = "src/assets";
  const distAssetsDir = "dist/assets";

  await fs.ensureDir(distAssetsDir);

  const shouldExcludeDirectory = (dirName) => {
    return dirName === "css" || dirName === "scss"; //if you want to move scss to dis then remove (|| dirName === 'scss')
  };

  async function copyFilesAndDirs(src, dest) {
    const items = await fs.readdir(src);

    for (const item of items) {
      const srcItemPath = path.join(src, item);
      const destItemPath = path.join(dest, item);

      const stats = await fs.stat(srcItemPath);

      if (stats.isDirectory()) {
        if (!shouldExcludeDirectory(item)) {
          await fs.ensureDir(destItemPath);
          await copyFilesAndDirs(srcItemPath, destItemPath);
        }
      } else {
        await fs.copyFile(srcItemPath, destItemPath);
      }
    }
  }

  await copyFilesAndDirs(srcAssetsDir, distAssetsDir);
  console.log("⚡ Assets Compiled! ⚡ ");
}

async function replaceIncludeTags(htmlContent, srcDir) {
  const includePattern = /<!--\s*include\s+(.*?)\s*-->/g;
  const matches = [...htmlContent.matchAll(includePattern)];

  for (const match of matches) {
    const partialPath = match[1].replace(/"+/g, "");
    const partialFilePath = path.join(srcDir, "partials", partialPath);
    const partialContent = await fs.readFile(partialFilePath, "utf-8");
    htmlContent = htmlContent.replace(match[0], partialContent);
  }

  return htmlContent;
}

async function processHTMLFiles(srcFile, distDir) {
  const srcFilePath = path.join(srcFile);
  const distFilePath = path.join(distDir, path.basename(srcFile));
  let htmlContent = await fs.readFile(srcFilePath, "utf-8");
  htmlContent = await replaceIncludeTags(
    htmlContent,
    path.dirname(srcFilePath)
  );
  try {
    await fs.writeFile(distFilePath, htmlContent);
    await buildCSS();
  } catch (error) {
    console.error("Error while rebuilding SCSS:", error);
  }
  console.log(`⚡ Updated ${srcFile} in ${distFilePath}`);
}

const ctx = esbuild.build({
  logLevel: "debug",
  metafile: true,
  entryPoints: [
    "src/assets/scss/styles.scss",
  ],
  outdir: "dist/assets/css",
  bundle: true,
  // watch: true,
  plugins: [
    sassPlugin({
      async transform(source) {
          const { css } = await postcss([tailwindcss, autoprefixer]).process(source, { from: undefined });
          return css;
          // const { css } = await postcss([autoprefixer]).process(source, { from: undefined });
          // return css;
      },
      // async transform(source) {
      //   const { css } = await postcss().process(source, {
      //     from: undefined,
      //   });
      //   return css;
      // },
    }),
  ],
  loader: {
    ".png": "file",
    ".jpg": "file",
    ".jpeg": "file",
    ".svg": "file",
    ".gif": "file",
    ".woff": "file",
    ".ttf": "file",
    ".eot": "file",
    ".woff2": "file",
    ".html": "file",
  },
});

ctx.then(async () => {
  console.log("⚡ Styles & Scripts Compiled! ⚡ ");
  // To Libs Dependencies
  await copyDependencies().then(() => {
    console.log("⚡ libs Compiled! ⚡ ");
  });
  // To HTML Partials
  await buildHTMLWithPartials();
  // To Copy the Assets
  await copyAssets();

  bs.init({
    server: {
      baseDir: "dist",
      // index: 'html/index.html',
      // directory: true,
    },
    startPath: "html/index.html",
    open: true,
    watch: true,
    files: ["dist/**/*"],
    online: false,
    tunnel: true,
    logLevel: "info",
  });

  bs.watch("dist/**/*").on("change", bs.reload);
  const srcHtmlDir = "src/html";
  const distHtmlDir = "dist/html";

  function watchAndProcessHTMLFiles() {
    const watcher = chokidar.watch(srcHtmlDir, {
      ignoreInitial: true,
    });
    watcher.on("change", async (srcFile) => {
      await processHTMLFiles(srcFile, distHtmlDir);
    });
    console.log(`⚡ Watching HTML files in ${srcHtmlDir} for changes...`);
  }

  // To Change the HTML
  watchAndProcessHTMLFiles();
});

ctx.catch(() => process.exit(1));

async function buildCSS() {
  const ctx = esbuild.build({
    logLevel: "debug",
    metafile: true,
    entryPoints: ["src/assets/scss/styles.scss"],
    outdir: "dist/assets/css",
    bundle: true,
    // watch: true,
    plugins: [
      sassPlugin({
        async transform(source) {
          const { css } = await postcss([tailwindcss, autoprefixer]).process(source, { from: undefined });
          // const { css } = await postcss([autoprefixer]).process(source, {
          //   from: undefined,
          // });
          return css;
        },
      }),
    ],
    loader: {
      ".png": "file",
      ".jpg": "file",
      ".jpeg": "file",
      ".svg": "file",
      ".gif": "file",
      ".woff": "file",
      ".ttf": "file",
      ".eot": "file",
      ".woff2": "file",
      ".html": "file",
    },
  });

  await ctx;

  console.log("⚡ Styles Compiled and copied to dist/css! ⚡");
}

chokidar.watch("src/assets/scss/**/*.scss").on("change", async () => {
  try {
    await buildCSS();
  } catch (error) {
    console.error("Error while rebuilding SCSS:", error);
  }
});

async function copyJS(jsFile) {
  const jsFileName = path.basename(jsFile);
  const distFilePath = path.join("dist/assets/js", jsFileName);

  await fs.copy(jsFile, distFilePath);
  await buildCSS();

  console.log(`⚡ Copied ${jsFileName} to dist/assets/js! ⚡`);
}

chokidar.watch("src/assets/js/**/*.js").on("change", async (jsFile) => {
  try {
    await copyJS(jsFile);
  } catch (error) {
    console.error("Error while copying JS:", error);
  }
});

function partialsChange() {
  const watcher = chokidar.watch("src/html/partials", {
    ignoreInitial: true,
  });
  watcher.on("change", async (srcFile) => {
    await buildHTMLWithPartials();
  });
}

partialsChange();
