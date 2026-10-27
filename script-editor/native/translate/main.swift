import Foundation
import NaturalLanguage
import Translation

struct Request: Decodable {
    let id: String
    let targetLanguage: String
    let texts: [String]
}

struct Response: Encodable {
    let id: String
    let index: Int
    let status: String
    var translation: String? = nil
    var sourceLanguage: String? = nil
    var targetLanguage: String? = nil
}

func emit(_ response: Response) {
    let data = try! JSONEncoder().encode(response)
    FileHandle.standardOutput.write(data + Data([10]))
}

@main
struct DialogueTranslator {
    static func main() async {
        while let line = readLine() {
            do {
                let request = try JSONDecoder().decode(Request.self, from: Data(line.utf8))
                if #available(macOS 26.0, *) {
                    await translate(request)
                } else {
                    for index in request.texts.indices {
                        emit(Response(id: request.id, index: index, status: "unsupported"))
                    }
                }
            } catch {
                FileHandle.standardError.write(Data("Invalid translation request\n".utf8))
            }
        }
    }

    @available(macOS 26.0, *)
    static func translate(_ request: Request) async {
        let target = Locale.Language(identifier: request.targetLanguage)
        var groups: [String: [Int]] = [:]
        for (index, text) in request.texts.enumerated() {
            let recognizer = NLLanguageRecognizer()
            recognizer.processString(text)
            guard let language = recognizer.dominantLanguage else {
                emit(Response(id: request.id, index: index, status: "unsupported"))
                continue
            }
            let source = language.rawValue
            if Locale.Language(identifier: source).languageCode == target.languageCode {
                emit(Response(id: request.id, index: index, status: "skipped"))
            } else {
                groups[source, default: []].append(index)
            }
        }
        for (source, indices) in groups {
            let sourceLanguage = Locale.Language(identifier: source)
            let availability = await LanguageAvailability().status(from: sourceLanguage, to: target)
            if availability != .installed {
                for index in indices {
                    emit(Response(id: request.id, index: index,
                                  status: availability == .supported ? "not-installed" : "unsupported",
                                  sourceLanguage: source, targetLanguage: request.targetLanguage))
                }
                continue
            }
            let session = TranslationSession(installedSource: sourceLanguage, target: target)
            let batch = indices.map {
                TranslationSession.Request(sourceText: request.texts[$0], clientIdentifier: String($0))
            }
            var remaining = Set(indices)
            do {
                for try await result in session.translate(batch: batch) {
                    let index = Int(result.clientIdentifier!)!
                    remaining.remove(index)
                    emit(Response(id: request.id, index: index, status: "translated", translation: result.targetText))
                }
            } catch {
                for index in remaining {
                    emit(Response(id: request.id, index: index,
                                  status: TranslationError.notInstalled ~= error ? "not-installed" : "error",
                                  sourceLanguage: source, targetLanguage: request.targetLanguage))
                }
            }
        }
    }
}
