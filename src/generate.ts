import { resolve } from 'path'
import ejs from 'ejs'
import fse from 'fs-extra'
import openapiTS, { astToString, OpenAPI3, OperationObject } from 'openapi-typescript'
import prettier from 'prettier'
import { groupBy, isArray, merge } from 'rattail'
import { logger } from 'rslog'
import { getConfig } from './config'
import { CWD } from './constants'
import { createTransformer, Transformer } from './transformer'
import {
  createStatusCodesByStrategy,
  getResponseMime,
  hasQueryParameter,
  hasResponseBody,
  isRequiredRequestBody,
  Preset,
  readSchema,
  readTemplateFile,
  StatusCodes,
  StatusCodeStrategy,
} from './utils'

export interface ApiModuleTemplateData {
  /**
   * API module metadata
   */
  apiModule: ApiModule
  /**
   * The name of the generated api ts type aggregation file
   */
  typesFilename: string
  /**
   * Whether to generate ts code
   */
  ts: boolean
}

export interface ApiModule {
  /**
   * The name of the API module
   */
  name: string
  /**
   * API module payloads
   */
  payloads: ApiModulePayload[]
}

export interface ApiModulePayload {
  /**
   * The name of the API function/dispatcher, such as apiGetUsers, apiCreatePost, apiUpdateComment, etc.
   */
  fn: string
  /**
   * The URL of the API endpoint, such as /users, /posts, /comments, etc.
   */
  url: string
  /**
   * The HTTP method of the API endpoint, such as get, post, put, delete, etc.
   */
  method: string
  /**
   * The HTTP verb of the API endpoint, such as Get, Create, Update, Delete, etc.
   */
  verb: string
  /**
   * The entity name of the API endpoint, such as User, Comment, Post, etc.
   */
  entity: string
  /**
   * The type name of the API endpoint, such as ApiGetUsers, ApiCreatePost, ApiUpdateComment, etc.
   */
  type: string
  /**
   * The value of the type of the API endpoint, such as paths['/users']['get'], paths['/posts']['post'], paths['/comments']['put'], etc.
   */
  typeValue: string
  /**
   * The type name of the query parameters of the API endpoint, such as ApiGetUsersQuery, ApiCreatePostQuery, ApiUpdateCommentQuery, etc.
   */
  typeQuery: string
  /**
   * The value of the type of the query parameters of the API endpoint, such as ApiGetUsersQuery['parameters']['query'], ApiCreatePostQuery['parameters']['query'], ApiUpdateCommentQuery['parameters']['query'], etc.
   */
  typeQueryValue: string
  /**
   * The type name of the request body of the API endpoint, such as ApiGetUsersRequestBody, ApiCreatePostRequestBody, ApiUpdateCommentRequestBody, etc.
   */
  typeRequestBody: string
  /**
   * The value of the type of the request body of the API endpoint, such as ApiGetUsersRequestBody['requestBody']['content']['application/json'], ApiCreatePostRequestBody['requestBody']['content']['application/json'], ApiUpdateCommentRequestBody['requestBody']['content']['application/json'], etc.
   */
  typeRequestBodyValue: string
  /**
   * The type name of the response body of the API endpoint, such as ApiGetUsersResponseBody, ApiCreatePostResponseBody, ApiUpdateCommentResponseBody, etc.
   */
  typeResponseBody: string
  /**
   * The value of the type of the response body of the API endpoint, such as ApiGetUsersResponseBody['responses']['200']['content']['application/json'], ApiCreatePostResponseBody['responses']['201']['content']['application/json'], ApiUpdateCommentResponseBody['responses']['200']['content']['application/json'], etc.
   */
  typeResponseBodyValue: string
}

export interface GenerateOptions {
  /**
   * The path to the OpenAPI/Swagger schema file.
   */
  input?: string
  /**
   * The path to the output directory.
   */
  output?: string
  /**
   * The base path of the API endpoints.
   */
  base?: string
  /**
   * The filename of the generated openapi types file.
   */
  typesFilename?: string
  /**
   * The transformer api options, used to override the default transformation rules.
   */
  transformer?: Partial<Transformer>
  /**
   * Whether to generate TypeScript code.
   */
  ts?: boolean
  /**
   * Whether to override the existing files, or an array of filenames to override.
   */
  overrides?: boolean | string[]
  /**
   * The preset ejs template to use.
   */
  preset?: Preset
  /**
   * The status code strategy to use. loose: all success status codes are 200, strict: use the openapi recommended success status codes.
   */
  statusCodeStrategy?: StatusCodeStrategy
  /**
   * The status codes to override the default status codes.
   */
  statusCodes?: {
    get?: number
    post?: number
    put?: number
    delete?: number
    patch?: number
    options?: number
    head?: number
  }
}

export function partitionApiModules(
  schema: OpenAPI3,
  transformer: Transformer,
  options: {
    ts: boolean
    statusCodes: StatusCodes
    base?: string
  },
): ApiModule[] {
  const { statusCodes, base } = options
  const schemaPaths = schema.paths ?? {}
  const schemaPathKeys = base ? Object.keys(schemaPaths).map((key) => key.replace(base, '')) : Object.keys(schemaPaths)
  const keyToPaths = groupBy(schemaPathKeys, (key) => key.split('/')[1])

  const apiModules = Object.entries(keyToPaths).reduce((apiModules, [name, paths]) => {
    const payloads = paths.reduce((payloads, path) => {
      path = base ? base + path : path
      const pathItems = schemaPaths[path] as Record<string, OperationObject>
      const childPayloads = Object.entries(pathItems).reduce((payloads, [method, operation]) => {
        const url = transformer.url({ path, base })
        const entity = transformer.entity({ path, method, base })
        const verb = transformer.verb({ method })
        const fn = transformer.fn({ verb, entity })

        const type = transformer.type({ verb, entity })
        const typeValue = transformer.typeValue({ path, method })
        const typeQuery = transformer.typeQuery({ verb, entity })
        const typeQueryValue = hasQueryParameter(operation) ? transformer.typeQueryValue({ type }) : 'never'

        const typeRequestBody = transformer.typeRequestBody({ verb, entity })
        const typeRequestBodyValue = operation.requestBody
          ? transformer.typeRequestBodyValue({
              type,
              required: isRequiredRequestBody(operation.requestBody),
            })
          : 'never'

        const statusCode = statusCodes[method as keyof StatusCodes] ?? 200
        const mime = getResponseMime(operation, statusCode)
        const typeResponseBody = transformer.typeResponseBody({ verb, entity })
        const typeResponseBodyValue =
          hasResponseBody(operation) && mime ? transformer.typeResponseBodyValue({ type, statusCode, mime }) : 'never'

        payloads.push({
          fn,
          url,
          method,
          verb,
          entity,
          type,
          typeValue,
          typeQuery,
          typeQueryValue,
          typeRequestBody,
          typeRequestBodyValue,
          typeResponseBody,
          typeResponseBodyValue,
        })

        return payloads
      }, [] as ApiModulePayload[])

      payloads.push(...childPayloads)

      return payloads
    }, [] as ApiModulePayload[])

    apiModules.push({ name: transformer.moduleName({ name }), payloads })

    return apiModules
  }, [] as ApiModule[])

  return apiModules
}

export function renderApiModules(
  apiModules: ApiModule[],
  options: {
    output: string
    typesFilename: string
    ts: boolean
    overrides: boolean | string[]
    preset: Preset
  },
) {
  const { output, ts, overrides, preset } = options
  const templateFile = readTemplateFile(preset)
  const typesFilename = options.typesFilename.replace('.ts', '')

  return Promise.all(
    apiModules.map(
      (apiModule) =>
        new Promise((promiseResolve) => {
          const data: ApiModuleTemplateData = {
            apiModule,
            typesFilename,
            ts,
          }

          prettier
            .format(ejs.render(templateFile, data), {
              parser: 'typescript',
              semi: false,
              singleQuote: true,
              printWidth: 120,
            })
            .then((content) => {
              const path = resolve(output, `${apiModule.name}.${ts ? 'ts' : 'js'}`)
              const shouldSkip =
                (!overrides || (isArray(overrides) && !overrides.includes(apiModule.name))) && fse.existsSync(path)

              if (shouldSkip) {
                logger.warn(`File already exists, skip: ${path}`)
                promiseResolve(content)
                return
              }

              fse.outputFileSync(path, content)
              logger.success(`Generated ${path}`)
              promiseResolve(content)
            })
        }),
    ),
  )
}

export async function generateTypes(schema: OpenAPI3, output: string, typesFilename: string) {
  const ast = await openapiTS(schema)
  const contents = astToString(ast)
  const typesFilepath = resolve(CWD, output, typesFilename)
  fse.outputFileSync(typesFilepath, contents)
  logger.success(`Generated ${typesFilepath}`)
}

export async function generate(userOptions: GenerateOptions = {}) {
  const config = await getConfig()
  const options = merge(config, userOptions)

  const {
    base,
    ts = true,
    overrides = true,
    preset = 'axle',
    statusCodeStrategy = 'strict',
    input = './schema.json',
    output = './src/apis',
    typesFilename = 'types.generated.ts',
    transformer = {},
  } = options

  const statusCodes = {
    ...createStatusCodesByStrategy(statusCodeStrategy),
    ...(options.statusCodes ?? {}),
  }

  const mergedTransformer = { ...createTransformer(), ...transformer }

  const schema = await readSchema(input)

  logger.info('Generating API modules...')

  if (ts) {
    await generateTypes(schema, output, typesFilename)
  }

  const apiModules = partitionApiModules(schema, mergedTransformer, { statusCodes, ts, base })
  await renderApiModules(apiModules, { output, typesFilename, ts, overrides, preset })
  logger.success('Done')
}
