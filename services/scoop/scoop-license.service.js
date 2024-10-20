import { URL } from 'url'
import Joi from 'joi'
import { NotFound, pathParam, queryParam } from '../index.js'
import { ConditionalGithubAuthV3Service } from '../github/github-auth-service.js'
import { fetchJsonFromRepo } from '../github/github-common-fetch.js'
import { renderLicenseBadge } from '../licenses.js'
import toArray from '../../core/base-service/to-array.js'

const gitHubRepoRegExp =
  /https:\/\/github.com\/(?<user>.*?)\/(?<repo>.*?)(\/|$)/

const bucketsSchema = Joi.object()
  .pattern(/.+/, Joi.string().pattern(gitHubRepoRegExp).required())
  .required()

const scoopSchema = Joi.object({
  license: Joi.alternatives()
    .try(
      Joi.string().required(),
      Joi.object({
        identifier: Joi.string().required(),
      }),
    )
    .required(),
}).required()

const queryParamSchema = Joi.object({
  bucket: Joi.string(),
})

export default class ScoopLicense extends ConditionalGithubAuthV3Service {
  // The buckets file (https://github.com/lukesampson/scoop/blob/master/buckets.json) changes very rarely.
  // Cache it for the lifetime of the current Node.js process.
  buckets = null

  static category = 'license'

  static route = {
    base: 'scoop/l',
    pattern: ':app',
    queryParamSchema,
  }

  static openApi = {
    '/scoop/l/{app}': {
      get: {
        summary: 'Scoop License',
        description:
          '[Scoop](https://scoop.sh/) is a command-line installer for Windows',
        parameters: [
          pathParam({ name: 'app', example: 'ngrok' }),
          queryParam({
            name: 'bucket',
            description:
              "App's containing bucket. Can either be a name (e.g `extras`) or a URL to a GitHub Repo (e.g `https://github.com/jewlexx/personal-scoop`)",
            example: 'extras',
          }),
        ],
      },
    },
  }

  static defaultBadgeData = { label: 'license' }

  static render({ licenses }) {
    return renderLicenseBadge({ licenses })
  }

  async handle({ app }, queryParams) {
    if (!this.buckets) {
      this.buckets = await fetchJsonFromRepo(this, {
        schema: bucketsSchema,
        user: 'ScoopInstaller',
        repo: 'Scoop',
        branch: 'master',
        filename: 'buckets.json',
      })
    }

    const bucket = queryParams.bucket || 'main'
    let bucketUrl = this.buckets[bucket]

    if (!bucketUrl) {
      // Parsing URL here will throw an error if the url is invalid
      try {
        const url = new URL(decodeURIComponent(bucket))

        // Throw errors to go to jump to catch statement
        // The error messages here are purely for code readability, and will never reach the user.
        if (url.hostname !== 'github.com') {
          throw new Error('Not a GitHub URL')
        }
        const path = url.pathname.split('/').filter(value => value !== '')

        if (path.length !== 2) {
          throw new Error('Not a valid GitHub Repo')
        }

        const [user, repo] = path

        // Reconstructing the url here ensures that the url will match the regex
        bucketUrl = `https://github.com/${user}/${repo}`
      } catch (e) {
        throw new NotFound({ prettyMessage: `bucket "${bucket}" not found` })
      }
    }

    const {
      groups: { user, repo },
    } = gitHubRepoRegExp.exec(bucketUrl)

    try {
      const { license } = await fetchJsonFromRepo(this, {
        schema: scoopSchema,
        user,
        repo,
        branch: 'master',
        filename: `bucket/${app}.json`,
      })

      const licenses = toArray(license).map(license =>
        typeof license === 'string' ? license : license.identifier,
      )
      return this.constructor.render({ licenses })
    } catch (error) {
      if (error instanceof NotFound) {
        throw new NotFound({
          prettyMessage: `${app} not found in bucket "${bucket}"`,
        })
      }
      throw error
    }
  }
}
